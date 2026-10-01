/**
 * AWS EC2 monthly NetworkOut monitor for Scripting.
 *
 * This console only calls CloudWatch GetMetricData and EC2
 * DescribeInstances. It never starts, stops, reboots, or changes an instance.
 */
import {
  Navigation,
  Script,
  NavigationStack,
  List,
  Section,
  ScrollView,
  VStack,
  HStack,
  ZStack,
  Text,
  Image,
  Circle,
  ProgressView,
  Button,
  Spacer,
  Divider,
  useState,
  useEffect,
  useCallback
} from "scripting"
import {
  APP_VERSION,
  AwsAppConfig,
  DEFAULT_CONFIG,
  SNAPSHOT_STORAGE_KEY,
  isConfigReady,
  loadConfigAsync,
  saveConfig
} from "./aws_config"
import { AwsMonitorData, AwsService } from "./aws"

const AWS_REGIONS = [
  { id: "us-east-1", label: "美国东部（弗吉尼亚）" },
  { id: "us-west-2", label: "美国西部（俄勒冈）" },
  { id: "ap-southeast-1", label: "亚太地区（新加坡）" },
  { id: "ap-northeast-1", label: "亚太地区（东京）" },
  { id: "eu-west-1", label: "欧洲（爱尔兰）" },
  { id: "eu-central-1", label: "欧洲（法兰克福）" },
  { id: "cn-north-1", label: "中国（北京）" },
  { id: "cn-northwest-1", label: "中国（宁夏）" }
]

function maskAccessKeyId(value: string): string {
  const text = value.trim()
  return text ? `••••${text.slice(-4)}` : "未设置"
}

function formatUpdatedAt(value: Date | string | undefined): string {
  if (!value) return "尚未同步"
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? "时间未知" : date.toLocaleString()
}

function humanizeAwsError(rawMessage: string): string {
  if (!rawMessage) return "AWS 请求失败"
  if (/AccessDenied|UnauthorizedOperation|not authorized/i.test(rawMessage)) {
    return "AWS 权限不足：请确认 IAM 已允许 cloudwatch:GetMetricData 和 ec2:DescribeInstances。若使用临时凭据，还要填写完整 Session Token。"
  }
  if (/SignatureDoesNotMatch/i.test(rawMessage)) {
    return "AWS 签名校验失败：请检查 Access Key、Secret、Region，并确认手机日期与时间为自动设置。"
  }
  if (/InvalidClientTokenId|UnrecognizedClientException|InvalidAccessKeyId/i.test(rawMessage)) {
    return "AWS 凭据无效或已失效：请检查 Access Key、Secret；临时凭据还必须填写 Session Token。"
  }
  if (/RequestExpired|RequestTimeTooSkewed/i.test(rawMessage)) {
    return "AWS 请求时间偏差过大：请将 iPhone 的日期与时间设为自动。"
  }
  if (/InvalidInstanceID\.NotFound|实例/i.test(rawMessage)) {
    return "找不到 EC2 实例：请确认 Instance ID 和 Region 与 AWS 控制台一致。"
  }
  if (/\(403\)/.test(rawMessage)) {
    return `AWS 返回 403：通常是 IAM 权限、凭据类型或签名问题。原始信息：${rawMessage}`
  }
  return rawMessage
}

function statusMeta(status: string): { label: string; color: string; icon: string } {
  switch (status) {
    case "running":
      return { label: "运行中", color: "systemGreen", icon: "checkmark.circle.fill" }
    case "stopped":
      return { label: "已停止", color: "systemIndigo", icon: "pause.circle.fill" }
    case "pending":
      return { label: "启动中", color: "systemOrange", icon: "arrow.clockwise.circle.fill" }
    case "stopping":
      return { label: "停止中", color: "systemOrange", icon: "arrow.clockwise.circle.fill" }
    default:
      return { label: "状态未知", color: "secondaryLabel", icon: "questionmark.circle.fill" }
  }
}

function loadCachedData(): AwsMonitorData | null {
  try {
    if (typeof Storage === "undefined" || !Storage.get) return null
    const raw = Storage.get(SNAPSHOT_STORAGE_KEY)
    if (!raw) return null
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw
    const updatedAt = new Date(parsed.updatedAt)
    if (!Number.isFinite(parsed.totalGB) || Number.isNaN(updatedAt.getTime())) return null
    return {
      ...parsed,
      updatedAt,
      instance: parsed.instance || { instanceId: "", status: "unknown" }
    } as AwsMonitorData
  } catch {
    return null
  }
}

function saveCachedData(data: AwsMonitorData): void {
  try {
    if (typeof Storage !== "undefined" && Storage.set) {
      Storage.set(SNAPSHOT_STORAGE_KEY, JSON.stringify(data))
    }
  } catch {}
}

function SettingsActionButton({
  label,
  action,
  accessibilityLabel
}: {
  label: string
  action: () => void
  accessibilityLabel: string
}) {
  return (
    <Button action={action} buttonStyle="glass" accessibilityLabel={accessibilityLabel}>
      <HStack spacing={4} alignment="center">
        <Text font="caption1" bold foregroundStyle="tintColor">{label}</Text>
        <Image systemName="chevron.right" font={10} foregroundStyle="secondaryLabel" />
      </HStack>
    </Button>
  )
}

function SettingsRow({
  icon,
  iconColor,
  title,
  detail,
  actionLabel,
  action,
  accessibilityLabel
}: {
  icon: string
  iconColor: string
  title: string
  detail: string
  actionLabel: string
  action: () => void
  accessibilityLabel: string
}) {
  return (
    <HStack alignment="center" spacing={12} padding={{ vertical: 4 }}>
      <Image systemName={icon} font={17} foregroundStyle={iconColor} frame={{ width: 28, height: 28 }} />
      <VStack alignment="leading" spacing={2} frame={{ maxWidth: Infinity, alignment: "leading" }}>
        <Text font="subheadline" foregroundStyle="label" lineLimit={1}>{title}</Text>
        <Text font="caption2" foregroundStyle="secondaryLabel" lineLimit={1}>{detail}</Text>
      </VStack>
      <SettingsActionButton label={actionLabel} action={action} accessibilityLabel={accessibilityLabel} />
    </HStack>
  )
}

function SettingsView({
  currentConfig,
  onSave,
  onCancel
}: {
  currentConfig: AwsAppConfig
  onSave: (config: AwsAppConfig) => void | Promise<void>
  onCancel: () => void
}) {
  const [accessKeyId, setAccessKeyId] = useState(currentConfig.accessKeyId)
  const [secretAccessKey, setSecretAccessKey] = useState(currentConfig.secretAccessKey)
  const [sessionToken, setSessionToken] = useState(currentConfig.sessionToken)
  const [region, setRegion] = useState(currentConfig.region || DEFAULT_CONFIG.region)
  const [instanceId, setInstanceId] = useState(currentConfig.instanceId)
  const [threshold, setThreshold] = useState(String(currentConfig.trafficThresholdGB || 100))
  const [errorNotice, setErrorNotice] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const promptField = async (
    title: string,
    message: string,
    currentValue: string,
    placeholder: string,
    onConfirm: (value: string) => void
  ) => {
    if (typeof Dialog !== "undefined" && Dialog.prompt) {
      const result = await Dialog.prompt({
        title,
        message,
        defaultValue: currentValue,
        placeholder,
        confirmLabel: "确定",
        cancelLabel: "取消"
      })
      if (result !== null) onConfirm(result.trim())
    }
  }

  const selectRegion = async () => {
    if (typeof Dialog === "undefined" || !Dialog.actionSheet) {
      await promptField("AWS Region", "请输入 EC2 所在 Region ID", region, "us-east-1", setRegion)
      return
    }
    const actions = AWS_REGIONS.map(item => ({
      label: `${item.id} · ${item.label}${region === item.id ? " ✓" : ""}`
    }))
    actions.push({ label: "自定义输入其他 Region ID..." })
    const selected = await Dialog.actionSheet({
      title: "选择 AWS Region",
      message: "必须与 EC2 实例所在 Region 一致",
      cancelButton: true,
      actions
    })
    if (selected === AWS_REGIONS.length) {
      await promptField("AWS Region", "请输入 EC2 所在 Region ID", region, "us-east-1", setRegion)
    } else if (selected !== null && selected >= 0) {
      setRegion(AWS_REGIONS[selected].id)
    }
  }

  const handleSave = async () => {
    if (saving) return
    const value = Number(threshold)
    if (!accessKeyId.trim() || !secretAccessKey.trim() || !region.trim() || !instanceId.trim()) {
      setErrorNotice("请填写 Access Key ID、Secret Access Key、Region 和 EC2 实例 ID。")
      return
    }
    if (!Number.isFinite(value) || value <= 0) {
      setErrorNotice("月流量阈值必须是大于 0 的数字。")
      return
    }
    const nextConfig: AwsAppConfig = {
      accessKeyId: accessKeyId.trim(),
      secretAccessKey: secretAccessKey.trim(),
      sessionToken: sessionToken.trim(),
      region: region.trim(),
      instanceId: instanceId.trim(),
      trafficThresholdGB: value
    }
    setSaving(true)
    setErrorNotice(null)
    try {
      const saved = await saveConfig(nextConfig)
      if (!saved) {
        setErrorNotice("本机 Storage 不可用，配置没有保存。请检查 Scripting 权限后重试。")
        return
      }
      await onSave(nextConfig)
    } finally {
      setSaving(false)
    }
  }

  return (
    <List
      background="systemGroupedBackground"
      navigationTitle="AWS 参数配置"
      navigationBarTitleDisplayMode="inline"
      toolbar={{
        topBarLeading: [<Button key="aws-settings-back" action={onCancel} disabled={saving} accessibilityLabel="返回主页"><Image systemName="chevron.backward" /></Button>],
        topBarTrailing: [<Button key="aws-settings-save" action={handleSave} disabled={saving} accessibilityLabel="保存配置"><Image systemName="checkmark" /></Button>]
      }}
    >
      {errorNotice && (
        <Section>
          <HStack alignment="top" spacing={8} padding={{ vertical: 4 }}>
            <Image systemName="exclamationmark.triangle.fill" font={13} foregroundStyle="systemRed" />
            <Text font="caption1" foregroundStyle="systemRed" lineLimit={3}>{errorNotice}</Text>
          </HStack>
        </Section>
      )}
      <Section
        header={<Text>AWS 只读凭据</Text>}
        footer={<Text font="footnote" foregroundStyle="secondaryLabel">凭据保存在 Scripting 本机 Storage。请只使用专用、最小权限 IAM 凭据，不要把凭据写进脚本。</Text>}
      >
        <SettingsRow
          icon="key"
          iconColor="systemOrange"
          title="Access Key ID"
          detail={maskAccessKeyId(accessKeyId)}
          actionLabel={accessKeyId ? "修改" : "设置"}
          accessibilityLabel="设置 AWS Access Key ID"
          action={() => promptField("Access Key ID", "请输入 AWS Access Key ID", accessKeyId, "AKIA...", setAccessKeyId)}
        />
        <SettingsRow
          icon="lock"
          iconColor="systemRed"
          title="Secret Access Key"
          detail={secretAccessKey ? "已设置" : "未设置"}
          actionLabel={secretAccessKey ? "修改" : "设置"}
          accessibilityLabel="设置 AWS Secret Access Key"
          action={() => promptField("Secret Access Key", "请输入 AWS Secret Access Key", "", "不会在界面显示", setSecretAccessKey)}
        />
        <SettingsRow
          icon="ticket"
          iconColor="systemPurple"
          title="Session Token（可选）"
          detail={sessionToken ? "已设置" : "长期 IAM 密钥可留空"}
          actionLabel={sessionToken ? "修改" : "设置"}
          accessibilityLabel="设置 AWS Session Token"
          action={() => promptField("Session Token", "使用临时凭据时填写；长期 IAM 密钥可留空", "", "可选", setSessionToken)}
        />
      </Section>
      <Section
        header={<Text>监控目标</Text>}
        footer={<Text font="footnote" foregroundStyle="secondaryLabel">Region 必须与 EC2 实例一致；本脚本只读查询状态和 NetworkOut。</Text>}
      >
        <SettingsRow
          icon="server.rack"
          iconColor="systemGreen"
          title="EC2 实例 ID"
          detail={instanceId || "未设置"}
          actionLabel={instanceId ? "修改" : "设置"}
          accessibilityLabel="设置 EC2 实例 ID"
          action={() => promptField("EC2 实例 ID", "请输入要监控的实例 ID", instanceId, "i-0123456789abcdef0", setInstanceId)}
        />
        <SettingsRow
          icon="globe"
          iconColor="systemBlue"
          title="AWS Region"
          detail={region}
          actionLabel="选择"
          accessibilityLabel="设置 AWS Region"
          action={selectRegion}
        />
      </Section>
      <Section
        header={<Text>月度流量阈值</Text>}
        footer={<Text font="footnote" foregroundStyle="secondaryLabel">默认 100 GB，按十进制 GB（1 GB = 1,000,000,000 bytes）计算；只用于本地提醒。</Text>}
      >
        <SettingsRow
          icon="speedometer"
          iconColor="systemTeal"
          title="NetworkOut 阈值"
          detail={`${threshold || "100"} GB / UTC 月`}
          actionLabel="修改"
          accessibilityLabel="设置 NetworkOut 月度阈值"
          action={() => promptField("NetworkOut 月度阈值（GB）", "仅作本地提醒参考，不代表 AWS 账单免费额度", threshold, "100", setThreshold)}
        />
      </Section>
      <Section>
        <Button action={handleSave} buttonStyle="glass" controlSize="large" disabled={saving} accessibilityLabel="保存配置并返回">
          <HStack spacing={8} alignment="center">
            <Image systemName={saving ? "arrow.clockwise" : "checkmark.circle.fill"} foregroundStyle="tintColor" />
            <Text font="headline" foregroundStyle="tintColor">{saving ? "正在保存" : "保存并返回主页"}</Text>
          </HStack>
        </Button>
      </Section>
      <Section>
        <VStack alignment="center" spacing={3} padding={{ vertical: 14 }}>
          <Text font={12} foregroundStyle="secondaryLabel">AWS EC2 Traffic Monitor v{APP_VERSION}</Text>
          <Text font={11} foregroundStyle="tertiaryLabel">CloudWatch NetworkOut · 只读</Text>
        </VStack>
      </Section>
    </List>
  )
}

function trafficMeta(data: AwsMonitorData | null): { label: string; color: string; icon: string } {
  if (!data) return { label: "等待同步", color: "secondaryLabel", icon: "clock" }
  if (data.statusLevel === "danger") {
    return { label: "已达到参考上限", color: "systemRed", icon: "exclamationmark.octagon.fill" }
  }
  if (data.statusLevel === "warning") {
    return { label: "接近参考上限", color: "systemOrange", icon: "exclamationmark.triangle.fill" }
  }
  return { label: "本月余量充足", color: "systemGreen", icon: "checkmark.seal.fill" }
}

function TrafficRing({ data, threshold }: { data: AwsMonitorData | null; threshold: number }) {
  const progress = data ? Math.min(1, Math.max(0, data.totalGB / threshold)) : 0
  const meta = trafficMeta(data)
  const ringSize = 174

  return (
    <ZStack frame={{ width: ringSize, height: ringSize }} alignment="center">
      <Circle
        stroke={{
          shapeStyle: "rgba(142, 142, 147, 0.18)",
          strokeStyle: { lineWidth: 12, lineCap: "round" }
        }}
        frame={{ width: ringSize, height: ringSize }}
      />
      {progress > 0.001 && (
        <Circle
          trim={{ from: 0, to: progress }}
          stroke={{
            shapeStyle: meta.color,
            strokeStyle: { lineWidth: 12, lineCap: "round" }
          }}
          rotationEffect={-90}
          frame={{ width: ringSize, height: ringSize }}
        />
      )}
      <VStack alignment="center" spacing={2}>
        <Text font="caption1" foregroundStyle="secondaryLabel">本月剩余</Text>
        <HStack alignment="lastTextBaseline" spacing={3}>
          <Text font={34} bold monospacedDigit lineLimit={1} minScaleFactor={0.65} foregroundStyle="label">
            {data ? data.remainingGB.toFixed(2) : "--"}
          </Text>
          <Text font="subheadline" foregroundStyle="secondaryLabel">GB</Text>
        </HStack>
        <Text font="caption2" foregroundStyle={meta.color}>
          {data ? `已用 ${data.percentage.toFixed(1)}%` : "等待首次同步"}
        </Text>
      </VStack>
    </ZStack>
  )
}

function TrafficOverview({
  data,
  threshold,
  loading
}: {
  data: AwsMonitorData | null
  threshold: number
  loading: boolean
}) {
  const meta = trafficMeta(data)
  const exceeded = data ? data.totalGB >= threshold : false
  const difference = data
    ? exceeded
      ? `超出 ${Math.max(0, data.totalGB - threshold).toFixed(2)} GB`
      : `还可使用 ${data.remainingGB.toFixed(2)} GB`
    : "点击右上角刷新读取 CloudWatch"

  return (
    <VStack
      spacing={14}
      padding={{ horizontal: 16, vertical: 18 }}
      frame={{ maxWidth: Infinity, alignment: "leading" }}
      background="systemBackground"
      border={{ style: "separator", width: 0.5 }}
      clipShape={{ type: "rect", cornerRadius: 18, style: "continuous" }}
    >
      <HStack alignment="center">
        <VStack alignment="leading" spacing={3}>
          <Text font="headline" bold foregroundStyle="label">本月流量余量</Text>
          <Text font="caption2" foregroundStyle="secondaryLabel">
            AWS EC2 NetworkOut · UTC {data?.monthKey || "本月"}
          </Text>
        </VStack>
        <Spacer />
        <HStack
          spacing={5}
          padding={{ horizontal: 9, vertical: 5 }}
          background="tertiarySystemFill"
          clipShape={{ type: "capsule" }}
          alignment="center"
        >
          <Image systemName={meta.icon} font={12} foregroundStyle={meta.color} />
          <Text font="caption2" bold foregroundStyle={meta.color}>{loading ? "同步中" : meta.label}</Text>
        </HStack>
      </HStack>

      <HStack alignment="center" spacing={12}>
        <TrafficRing data={data} threshold={threshold} />
        <VStack alignment="leading" spacing={12} frame={{ maxWidth: Infinity, alignment: "leading" }}>
          <VStack alignment="leading" spacing={3}>
            <Text font="caption1" foregroundStyle="secondaryLabel">当前月用量</Text>
            <HStack alignment="lastTextBaseline" spacing={3}>
              <Text font={22} bold monospacedDigit foregroundStyle={exceeded ? "systemRed" : "label"}>
                {data ? data.totalGB.toFixed(2) : "--"}
              </Text>
              <Text font="caption1" foregroundStyle="secondaryLabel">/ {threshold} GB</Text>
            </HStack>
          </VStack>
          <VStack alignment="leading" spacing={3}>
            <Text font="caption1" foregroundStyle="secondaryLabel">{exceeded ? "状态" : "余量提示"}</Text>
            <Text font="subheadline" bold foregroundStyle={meta.color} lineLimit={2}>{difference}</Text>
          </VStack>
        </VStack>
      </HStack>

      <ProgressView
        progressViewStyle="linear"
        value={progressValue(data, threshold)}
        total={1}
        tint={meta.color}
        frame={{ maxWidth: Infinity, height: 7 }}
      />
      <HStack alignment="center">
        <Text font="caption2" foregroundStyle="secondaryLabel">
          已使用 {data ? data.percentage.toFixed(1) : "0.0"}%
        </Text>
        <Spacer />
        <Text font="caption2" foregroundStyle="tertiaryLabel">
          {data ? `${data.datapointCount} 个 5 分钟数据点` : "尚未取得数据"}
        </Text>
      </HStack>
    </VStack>
  )
}

function progressValue(data: AwsMonitorData | null, threshold: number): number {
  return data ? Math.min(1, Math.max(0, data.totalGB / threshold)) : 0
}

function UnconfiguredView({ onOpenSettings }: { onOpenSettings: () => void }) {
  return (
    <VStack
      alignment="center"
      spacing={16}
      padding={{ horizontal: 24, vertical: 42 }}
      frame={{ maxWidth: Infinity, alignment: "center" }}
      background="systemBackground"
      border={{ style: "separator", width: 0.5 }}
      clipShape={{ type: "rect", cornerRadius: 18, style: "continuous" }}
    >
      <ZStack
        frame={{ width: 58, height: 58 }}
        background="tertiarySystemFill"
        clipShape={{ type: "rect", cornerRadius: 16, style: "continuous" }}
      >
        <Image systemName="gearshape.2.fill" font={25} foregroundStyle="systemOrange" />
      </ZStack>
      <VStack alignment="center" spacing={6}>
        <Text font="title3" bold foregroundStyle="label">尚未配置 AWS</Text>
        <Text
          font="subheadline"
          foregroundStyle="secondaryLabel"
          multilineTextAlignment="center"
          lineLimit={3}
        >
          保存 Access Key、Region 和 EC2 实例 ID 后，主页会显示本月 NetworkOut 流量。
        </Text>
      </VStack>
      <Button action={onOpenSettings} buttonStyle="borderedProminent" controlSize="large" accessibilityLabel="进入 AWS 设置">
        <HStack spacing={7} alignment="center">
          <Image systemName="gearshape" />
          <Text font="headline">进入设置</Text>
        </HStack>
      </Button>
    </VStack>
  )
}

function ConsoleView() {
  const [config, setConfig] = useState<AwsAppConfig>(DEFAULT_CONFIG)
  const [storageReady, setStorageReady] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [data, setData] = useState<AwsMonitorData | null>(loadCachedData())
  const [loading, setLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const loadData = useCallback(async (nextConfig: AwsAppConfig = config) => {
    if (!isConfigReady(nextConfig)) {
      setErrorMessage("尚未配置 AWS 查询参数，请先进入设置。")
      return
    }
    setLoading(true)
    setErrorMessage(null)
    try {
      const result = await new AwsService(nextConfig).getMonitorData()
      setData(result)
      saveCachedData(result)
    } catch (error: any) {
      const message = humanizeAwsError(error?.message || "AWS 请求失败，请检查 Region、实例 ID 和只读权限")
      setErrorMessage(message)
    } finally {
      setLoading(false)
    }
  }, [config])

  useEffect(() => {
    loadConfigAsync().then(nextConfig => {
      setConfig(nextConfig)
      setShowSettings(false)
      setStorageReady(true)
      if (isConfigReady(nextConfig)) loadData(nextConfig)
    })
  }, [])

  if (!storageReady) {
    return (
      <NavigationStack>
        <List
          background="systemGroupedBackground"
          navigationTitle="AWS EC2 监控"
          navigationBarTitleDisplayMode="inline"
        >
          <Section>
            <HStack alignment="center" spacing={10} padding={{ vertical: 12 }}>
              <Image systemName="arrow.clockwise" foregroundStyle="tintColor" />
              <Text font="body" foregroundStyle="secondaryLabel">正在读取本机配置...</Text>
            </HStack>
          </Section>
        </List>
      </NavigationStack>
    )
  }

  if (showSettings) {
    return (
      <NavigationStack>
        <SettingsView
          currentConfig={config}
          onSave={nextConfig => {
            setConfig(nextConfig)
            setShowSettings(false)
            loadData(nextConfig)
          }}
          onCancel={() => setShowSettings(false)}
        />
      </NavigationStack>
    )
  }

  const threshold = config.trafficThresholdGB || DEFAULT_CONFIG.trafficThresholdGB
  const meta = statusMeta(data?.instance?.status || "unknown")
  return (
    <NavigationStack>
      <ScrollView
        background="systemGroupedBackground"
        showsIndicators={false}
        navigationTitle="AWS EC2 监控"
        navigationBarTitleDisplayMode="large"
        toolbar={{
          topBarTrailing: [
            <Button
              key="aws-refresh"
              action={() => loadData(config)}
              disabled={loading}
              accessibilityLabel="刷新 AWS 数据"
            >
              <Image systemName="arrow.clockwise" foregroundStyle="tintColor" />
            </Button>,
            <Button key="aws-settings" action={() => setShowSettings(true)} accessibilityLabel="打开 AWS 设置">
              <Image systemName="gearshape" foregroundStyle="tintColor" />
            </Button>
          ]
        }}
      >
        <VStack alignment="leading" spacing={12} padding={{ horizontal: 16, top: 8, bottom: 36 }}>
          {!isConfigReady(config) ? (
            <UnconfiguredView onOpenSettings={() => setShowSettings(true)} />
          ) : (
            <>
              {errorMessage && (
                <HStack
                  alignment="top"
                  spacing={8}
                  padding={{ horizontal: 14, vertical: 12 }}
                  background="secondarySystemBackground"
                  border={{ style: "separator", width: 0.5 }}
                  clipShape={{ type: "rect", cornerRadius: 14, style: "continuous" }}
                >
                  <Image systemName="exclamationmark.triangle.fill" font={13} foregroundStyle="systemRed" />
                  <Text font="caption1" foregroundStyle="systemRed" lineLimit={4} frame={{ maxWidth: Infinity, alignment: "leading" }}>{errorMessage}</Text>
                </HStack>
              )}

              <TrafficOverview data={data} threshold={threshold} loading={loading} />

              <HStack alignment="center" padding={{ horizontal: 4 }}>
                <Image systemName="clock" font={12} foregroundStyle="secondaryLabel" />
                <Text font="caption2" foregroundStyle="secondaryLabel">最后更新：{formatUpdatedAt(data?.updatedAt)}</Text>
                <Spacer />
                <Text font="caption2" foregroundStyle="secondaryLabel">阈值 {threshold} GB</Text>
              </HStack>

              <VStack
                spacing={0}
                background="systemBackground"
                border={{ style: "separator", width: 0.5 }}
                clipShape={{ type: "rect", cornerRadius: 16, style: "continuous" }}
              >
                <HStack padding={{ horizontal: 16, vertical: 14 }} alignment="center" spacing={12}>
                  <ZStack
                    frame={{ width: 36, height: 36 }}
                    background="tertiarySystemFill"
                    clipShape={{ type: "rect", cornerRadius: 10, style: "continuous" }}
                  >
                    <Image systemName="server.rack" font={16} foregroundStyle={meta.color} />
                  </ZStack>
                  <VStack alignment="leading" spacing={3} frame={{ maxWidth: Infinity, alignment: "leading" }}>
                    <Text font="subheadline" bold foregroundStyle="label">EC2 实例状态</Text>
                    <Text font="caption2" foregroundStyle="secondaryLabel" lineLimit={1}>
                      {data?.instance?.instanceId || config.instanceId} · {config.region}
                    </Text>
                  </VStack>
                  <VStack alignment="trailing" spacing={2}>
                    <Text font="subheadline" bold foregroundStyle={meta.color}>{meta.label}</Text>
                    <Text font="caption2" foregroundStyle="secondaryLabel">只读查询</Text>
                  </VStack>
                </HStack>
                <Divider padding={{ horizontal: 16 }} />
                <HStack padding={{ horizontal: 16, vertical: 13 }} alignment="center" spacing={12}>
                  <Image systemName="waveform.path.ecg" font={16} foregroundStyle="systemTeal" frame={{ width: 36, height: 28 }} />
                  <VStack alignment="leading" spacing={3} frame={{ maxWidth: Infinity, alignment: "leading" }}>
                    <Text font="subheadline" foregroundStyle="label">统计口径</Text>
                    <Text font="caption2" foregroundStyle="secondaryLabel" lineLimit={2}>
                      CloudWatch · Sum · 300 秒 · UTC 自然月
                    </Text>
                  </VStack>
                  <Text font="caption2" foregroundStyle="secondaryLabel">NetworkOut</Text>
                </HStack>
              </VStack>

              <Text font="caption2" foregroundStyle="tertiaryLabel" padding={{ horizontal: 4, top: 2 }}>
                这里显示的是当前 EC2 实例的 NetworkOut，不等于 AWS 账号所有服务的账单出站总量；CloudWatch 数据可能有延迟。
              </Text>
            </>
          )}
        </VStack>
      </ScrollView>
    </NavigationStack>
  )
}

async function main() {
  await Navigation.present({ element: <ConsoleView /> })
  Script.exit()
}

main()

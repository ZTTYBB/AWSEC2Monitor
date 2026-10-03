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
  hasCredentials,
  hasMonitorTarget,
  hasRegion,
  isConfigReady,
  loadConfig,
  saveConfig
} from "./aws_config"
import { AwsMonitorData, AwsService } from "./aws"
import { getDailyBudget } from "./aws_budget"

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
    return "AWS 查询权限不足：请确认 IAM 已允许 cloudwatch:GetMetricData 和 ec2:DescribeInstances。若使用临时凭据，还要填写完整 Session Token。"
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
    return `AWS 返回 403：通常是 IAM 查询权限、凭据类型或签名问题。原始信息：${rawMessage}`
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

function SettingsRow({
  icon,
  iconColor,
  title,
  detail,
  action,
  accessibilityLabel
}: {
  icon: string
  iconColor: string
  title: string
  detail: string
  action: () => void
  accessibilityLabel: string
}) {
  return (
    <Button action={action} accessibilityLabel={accessibilityLabel}>
      <HStack
        alignment="center"
        spacing={12}
        padding={{ horizontal: 14, vertical: 12 }}
        frame={{ maxWidth: Infinity, alignment: "leading" }}
      >
        <ZStack
          frame={{ width: 34, height: 34 }}
          background="tertiarySystemFill"
          clipShape={{ type: "rect", cornerRadius: 10, style: "continuous" }}
        >
          <Image systemName={icon} font={15} foregroundStyle={iconColor} />
        </ZStack>
        <VStack alignment="leading" spacing={3} frame={{ maxWidth: Infinity, alignment: "leading" }}>
          <Text font="subheadline" foregroundStyle="label" lineLimit={1}>{title}</Text>
          <Text font="caption2" foregroundStyle="secondaryLabel" lineLimit={2}>{detail}</Text>
        </VStack>
        <Image systemName="chevron.right" font={11} foregroundStyle="tertiaryLabel" />
      </HStack>
    </Button>
  )
}

function SettingsGroup({
  title,
  footer,
  children
}: {
  title: string
  footer: string
  children?: any
}) {
  return (
    <VStack alignment="leading" spacing={8} frame={{ maxWidth: Infinity, alignment: "leading" }}>
      <Text font="caption1" bold foregroundStyle="secondaryLabel" padding={{ horizontal: 4 }}>
        {title}
      </Text>
      <VStack
        alignment="leading"
        spacing={0}
        frame={{ maxWidth: Infinity, alignment: "leading" }}
        background="secondarySystemBackground"
        clipShape={{ type: "rect", cornerRadius: 16, style: "continuous" }}
      >
        {children}
      </VStack>
      <Text font="caption2" foregroundStyle="tertiaryLabel" padding={{ horizontal: 4 }}>
        {footer}
      </Text>
    </VStack>
  )
}

function SettingsView({
  currentConfig,
  onSave,
  onCancel
}: {
  currentConfig: AwsAppConfig
  onSave: (config: AwsAppConfig) => void
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

  const handleSave = () => {
    if (saving) return
    const value = Number(threshold)
    const draftConfig: AwsAppConfig = {
      accessKeyId: accessKeyId.trim(),
      secretAccessKey: secretAccessKey.trim(),
      sessionToken: sessionToken.trim(),
      region: region.trim(),
      instanceId: instanceId.trim(),
      trafficThresholdGB: value
    }
    if (!hasCredentials(draftConfig) || !hasRegion(draftConfig)) {
      setErrorNotice("请填写 Access Key ID、Secret Access Key 和 AWS Region。EC2 实例 ID 可以稍后补充。")
      return
    }
    if (!Number.isFinite(value) || value <= 0) {
      setErrorNotice("月流量阈值必须是大于 0 的数字。")
      return
    }
    setSaving(true)
    setErrorNotice(null)
    try {
      const savedConfig = saveConfig(draftConfig)
      // Keep the in-memory homepage state identical to the complete form
      // payload. Storage is checked again only when the next view opens.
      onSave(savedConfig)
    } catch (error: any) {
      setErrorNotice(error?.message || "保存失败，请确认 Scripting 本机 Storage 可用后重试。")
    } finally {
      setSaving(false)
    }
  }

  return (
    <ScrollView
      background="systemGroupedBackground"
      showsIndicators={false}
      navigationTitle="设置"
      navigationBarTitleDisplayMode="large"
      toolbar={{
        topBarLeading: [
          <Button key="aws-settings-back" action={onCancel} disabled={saving} accessibilityLabel="返回主页">
            <Image systemName="chevron.backward" foregroundStyle="label" />
          </Button>
        ],
        topBarTrailing: [<Button key="aws-settings-save" action={handleSave} disabled={saving} accessibilityLabel="保存配置"><Image systemName="checkmark" /></Button>]
      }}
    >
      <VStack
        alignment="leading"
        spacing={22}
        padding={{ horizontal: 16, top: 10, bottom: 40 }}
        frame={{ maxWidth: Infinity, alignment: "leading" }}
      >
        <VStack alignment="leading" spacing={4}>
          <Text font="title2" bold foregroundStyle="label">AWS EC2 监控</Text>
          <Text font="subheadline" foregroundStyle="secondaryLabel">
            凭据只保存在本机，用于读取 CloudWatch 和 EC2 状态。
          </Text>
        </VStack>

        {errorNotice && (
          <HStack
            alignment="top"
            spacing={9}
            padding={{ horizontal: 14, vertical: 12 }}
            background="rgba(255, 59, 48, 0.10)"
            clipShape={{ type: "rect", cornerRadius: 14, style: "continuous" }}
          >
            <Image systemName="exclamationmark.triangle.fill" font={13} foregroundStyle="systemRed" />
            <Text font="caption1" foregroundStyle="systemRed" lineLimit={4} frame={{ maxWidth: Infinity, alignment: "leading" }}>
              {errorNotice}
            </Text>
          </HStack>
        )}

        <SettingsGroup
          title="AWS 查询凭据"
          footer="长期 IAM 密钥可留空 Session Token；临时凭据必须填写完整 Token。"
        >
          <SettingsRow
            icon="key.fill"
            iconColor="systemOrange"
            title="Access Key ID"
            detail={maskAccessKeyId(accessKeyId)}
            accessibilityLabel="设置 AWS Access Key ID"
            action={() => promptField("Access Key ID", "请输入 AWS Access Key ID", accessKeyId, "AKIA...", setAccessKeyId)}
          />
          <Divider padding={{ horizontal: 14 }} />
          <SettingsRow
            icon="lock.fill"
            iconColor="systemRed"
            title="Secret Access Key"
            detail={secretAccessKey ? "已保存 · 不在界面显示" : "尚未设置"}
            accessibilityLabel="设置 AWS Secret Access Key"
            action={() => promptField("Secret Access Key", "请输入 AWS Secret Access Key", "", "不会在界面显示", setSecretAccessKey)}
          />
          <Divider padding={{ horizontal: 14 }} />
          <SettingsRow
            icon="ticket.fill"
            iconColor="systemPurple"
            title="Session Token"
            detail={sessionToken ? "已保存 · 临时凭据" : "可选 · 长期密钥留空"}
            accessibilityLabel="设置 AWS Session Token"
            action={() => promptField("Session Token", "使用临时凭据时填写；长期 IAM 密钥可留空", "", "可选", setSessionToken)}
          />
        </SettingsGroup>

        <SettingsGroup
          title="监控目标"
          footer="Region 必须与 EC2 实例一致；Instance ID 补齐后才会开始查询。"
        >
          <SettingsRow
            icon="server.rack"
            iconColor="systemGreen"
            title="EC2 实例 ID"
            detail={instanceId || "尚未设置"}
            accessibilityLabel="设置 EC2 实例 ID"
            action={() => promptField("EC2 实例 ID", "请输入要监控的实例 ID", instanceId, "i-0123456789abcdef0", setInstanceId)}
          />
          <Divider padding={{ horizontal: 14 }} />
          <SettingsRow
            icon="globe"
            iconColor="systemBlue"
            title="AWS Region"
            detail={region}
            accessibilityLabel="设置 AWS Region"
            action={selectRegion}
          />
        </SettingsGroup>

        <SettingsGroup
          title="流量提醒"
          footer="沿用二进制流量单位（1 GB = 1,073,741,824 bytes），仅用于本地看板提醒，不代表 AWS 账单免费额度。"
        >
          <SettingsRow
            icon="speedometer"
            iconColor="systemTeal"
            title="NetworkOut 月度阈值"
            detail={`${threshold || "100"} GB / UTC 自然月`}
            accessibilityLabel="设置 NetworkOut 月度阈值"
            action={() => promptField("NetworkOut 月度阈值（GB）", "仅作本地提醒参考，不代表 AWS 账单免费额度", threshold, "100", setThreshold)}
          />
        </SettingsGroup>

        <VStack alignment="center" spacing={3} padding={{ top: 4, bottom: 8 }}>
          <Text font="caption2" foregroundStyle="secondaryLabel">AWS EC2 Traffic Monitor · v{APP_VERSION}</Text>
          <Text font="caption2" foregroundStyle="tertiaryLabel">CloudWatch NetworkOut · 只读查询</Text>
        </VStack>
      </VStack>
    </ScrollView>
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

function StatusBadge({
  data,
  loading
}: {
  data: AwsMonitorData | null
  loading?: boolean
}) {
  const meta = trafficMeta(data)
  return (
    <HStack
      spacing={5}
      padding={{ horizontal: 10, vertical: 6 }}
      background="tertiarySystemFill"
      clipShape="capsule"
      alignment="center"
    >
      <Image systemName={loading ? "arrow.clockwise" : meta.icon} font={12} foregroundStyle={loading ? "systemBlue" : meta.color} />
      <Text font="caption2" bold foregroundStyle={loading ? "systemBlue" : meta.color}>
        {loading ? "同步中" : meta.label}
      </Text>
    </HStack>
  )
}

function DashboardStat({
  icon,
  iconColor,
  title,
  value,
  detail
}: {
  icon: string
  iconColor: string
  title: string
  value: string
  detail: string
}) {
  return (
    <VStack
      alignment="leading"
      spacing={5}
      frame={{ maxWidth: Infinity, alignment: "leading" }}
    >
      <HStack spacing={6} alignment="center">
        <Image systemName={icon} font={12} foregroundStyle={iconColor} />
        <Text font="caption2" foregroundStyle="secondaryLabel" lineLimit={1}>{title}</Text>
      </HStack>
      <Text font="headline" bold monospacedDigit foregroundStyle="label" lineLimit={1} minScaleFactor={0.7}>
        {value}
      </Text>
      <Text font="caption2" foregroundStyle="tertiaryLabel" lineLimit={1}>{detail}</Text>
    </VStack>
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
  const budget = getDailyBudget(data)
  const exceeded = data ? data.totalGB >= threshold : false
  const difference = data
    ? exceeded
      ? `超出 ${Math.max(0, data.totalGB - threshold).toFixed(2)} GB`
      : `还可使用 ${data.remainingGB.toFixed(2)} GB`
    : "点击右上角刷新读取 CloudWatch"

  return (
    <VStack
      alignment="leading"
      spacing={18}
      padding={18}
      frame={{ maxWidth: Infinity, alignment: "leading" }}
      background="secondarySystemBackground"
      clipShape={{ type: "rect", cornerRadius: 24, style: "continuous" }}
    >
      <HStack alignment="center">
        <HStack spacing={10} alignment="center">
          <ZStack
            frame={{ width: 38, height: 38 }}
            background="rgba(255, 149, 0, 0.16)"
            clipShape={{ type: "rect", cornerRadius: 12, style: "continuous" }}
          >
            <Image systemName="cloud.fill" font={18} foregroundStyle="systemOrange" />
          </ZStack>
          <VStack alignment="leading" spacing={3}>
            <Text font="headline" bold foregroundStyle="label">NetworkOut</Text>
            <Text font="caption2" foregroundStyle="secondaryLabel">
              AWS EC2 · UTC {data?.monthKey || "本月"}
            </Text>
          </VStack>
        </HStack>
        <Spacer />
        <StatusBadge data={data} loading={loading} />
      </HStack>

      <VStack alignment="center" spacing={11} frame={{ maxWidth: Infinity, alignment: "center" }}>
        <TrafficRing data={data} threshold={threshold} />
        <VStack alignment="center" spacing={3}>
          <Text font="caption1" foregroundStyle="secondaryLabel">{exceeded ? "月度阈值" : "余量提示"}</Text>
          <Text font="subheadline" bold foregroundStyle={meta.color} lineLimit={2}>{difference}</Text>
        </VStack>
      </VStack>

      <ProgressView
        progressViewStyle="linear"
        value={progressValue(data, threshold)}
        total={1}
        tint={meta.color}
        frame={{ maxWidth: Infinity, height: 7 }}
      />
      <HStack spacing={14} alignment="top" frame={{ maxWidth: Infinity, alignment: "leading" }}>
        <DashboardStat
          icon="chart.bar.fill"
          iconColor="systemBlue"
          title="当前用量"
          value={data ? `${data.totalGB.toFixed(2)} GB` : "--"}
          detail={`阈值 ${threshold} GB`}
        />
        <DashboardStat
          icon="gauge.with.dots.needle.67percent"
          iconColor={exceeded ? "systemRed" : "systemGreen"}
          title="已使用"
          value={data ? `${data.percentage.toFixed(1)}%` : "--"}
          detail={data ? `${data.datapointCount} 个数据点` : "尚未取得数据"}
        />
      </HStack>
      <DashboardStat
        icon="calendar"
        iconColor="systemTeal"
        title="日均可用"
        value={budget ? `${budget.dailyAvailableGB.toFixed(2)} GB` : "--"}
        detail={budget ? `UTC 剩余 ${budget.remainingDays} 天（含今天）` : "待更新"}
      />
    </VStack>
  )
}

function progressValue(data: AwsMonitorData | null, threshold: number): number {
  return data ? Math.min(1, Math.max(0, data.totalGB / threshold)) : 0
}

function SetupPromptView({
  config,
  onOpenSettings
}: {
  config: AwsAppConfig
  onOpenSettings: () => void
}) {
  const credentialsSaved = hasCredentials(config) && hasRegion(config)
  return (
    <VStack
      alignment="center"
      spacing={18}
      padding={{ horizontal: 22, vertical: 30 }}
      frame={{ maxWidth: Infinity, alignment: "center" }}
      background="secondarySystemBackground"
      clipShape={{ type: "rect", cornerRadius: 24, style: "continuous" }}
    >
      <ZStack
        frame={{ width: 66, height: 66 }}
        background="rgba(255, 149, 0, 0.16)"
        clipShape={{ type: "rect", cornerRadius: 20, style: "continuous" }}
      >
        <Image systemName="cloud.fill" font={30} foregroundStyle="systemOrange" />
      </ZStack>
      <VStack alignment="center" spacing={6}>
        <Text font="title3" bold foregroundStyle="label">
          {credentialsSaved ? "还需要设置监控目标" : "连接 AWS 监控"}
        </Text>
        <Text
          font="subheadline"
          foregroundStyle="secondaryLabel"
          multilineTextAlignment="center"
          lineLimit={3}
        >
          {credentialsSaved
            ? `凭据已保存。请在设置中补充 EC2 实例 ID，主页才会查询 ${config.region} 的 NetworkOut。`
            : "在设置中添加查询凭据和 Region，随后再选择需要监控的 EC2 实例。"}
        </Text>
      </VStack>
      <HStack
        spacing={7}
        padding={{ horizontal: 12, vertical: 8 }}
        background="tertiarySystemFill"
        clipShape="capsule"
      >
        <Image systemName={credentialsSaved ? "checkmark.circle.fill" : "lock.shield.fill"} font={12} foregroundStyle={credentialsSaved ? "systemGreen" : "systemBlue"} />
        <Text font="caption2" foregroundStyle="secondaryLabel">
          {credentialsSaved ? `凭据已保存 · ${config.region}` : "只读查询 · 凭据保存在本机"}
        </Text>
      </HStack>
      <Button action={onOpenSettings} buttonStyle="borderedProminent" controlSize="large" accessibilityLabel="进入 AWS 设置">
        <HStack spacing={7} alignment="center">
          <Image systemName="gearshape" />
          <Text font="headline">打开设置</Text>
        </HStack>
      </Button>
    </VStack>
  )
}

function ConsoleView() {
  const [config, setConfig] = useState<AwsAppConfig>(loadConfig())
  const [showSettings, setShowSettings] = useState(false)
  const [data, setData] = useState<AwsMonitorData | null>(loadCachedData())
  const [loading, setLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const loadData = useCallback(async (nextConfig: AwsAppConfig = config) => {
    if (!isConfigReady(nextConfig)) {
      setErrorMessage(null)
      return
    }
    setLoading(true)
    setErrorMessage(null)
    try {
      const result = await new AwsService(nextConfig).getMonitorData()
      setData(result)
      saveCachedData(result)
    } catch (error: any) {
      const message = humanizeAwsError(error?.message || "AWS 请求失败，请检查 Region、实例 ID 和 IAM 查询权限")
      setErrorMessage(message)
    } finally {
      setLoading(false)
    }
  }, [config])

  const openSettings = () => {
    // Read the persisted value at the moment settings opens so a script
    // restart or a widget/app lifecycle change cannot leave stale state here.
    setConfig(loadConfig())
    setShowSettings(true)
  }

  useEffect(() => {
    if (isConfigReady(config)) loadData(config)
  }, [])

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
        toolbarBackground="clear"
        toolbarBackgroundVisibility={{ visibility: "hidden", bars: ["navigationBar"] }}
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
            <Button key="aws-settings" action={openSettings} accessibilityLabel="打开 AWS 设置">
              <Image systemName="gearshape" foregroundStyle="tintColor" />
            </Button>
          ]
        }}
      >
        <VStack alignment="leading" spacing={18} padding={{ horizontal: 16, top: 8, bottom: 40 }}>
          <HStack alignment="center" padding={{ horizontal: 4 }}>
            <VStack alignment="leading" spacing={3} frame={{ maxWidth: Infinity, alignment: "leading" }}>
              <Text font="subheadline" foregroundStyle="secondaryLabel">本月出站流量看板</Text>
              <Text font="caption2" foregroundStyle="tertiaryLabel">CloudWatch · Sum · 300 秒 · UTC 自然月</Text>
            </VStack>
            {isConfigReady(config) && <StatusBadge data={data} loading={loading} />}
          </HStack>

          {!hasCredentials(config) || !hasRegion(config) || !hasMonitorTarget(config) ? (
            <SetupPromptView config={config} onOpenSettings={() => setShowSettings(true)} />
          ) : (
            <>
              {errorMessage && (
                <HStack
                  alignment="top"
                  spacing={8}
                  padding={{ horizontal: 14, vertical: 12 }}
                  background="rgba(255, 59, 48, 0.10)"
                  clipShape={{ type: "rect", cornerRadius: 14, style: "continuous" }}
                >
                  <Image systemName="exclamationmark.triangle.fill" font={13} foregroundStyle="systemRed" />
                  <Text font="caption1" foregroundStyle="systemRed" lineLimit={4} frame={{ maxWidth: Infinity, alignment: "leading" }}>{errorMessage}</Text>
                </HStack>
              )}

              <TrafficOverview data={data} threshold={threshold} loading={loading} />

              <HStack alignment="center" padding={{ horizontal: 4 }}>
                <Image systemName="clock" font={12} foregroundStyle="secondaryLabel" />
                <Text font="caption2" foregroundStyle="secondaryLabel" lineLimit={1}>
                  最后更新：{formatUpdatedAt(data?.updatedAt)}
                </Text>
                <Spacer />
                <Text font="caption2" foregroundStyle="secondaryLabel">阈值 {threshold} GB</Text>
              </HStack>

              <VStack
                alignment="leading"
                spacing={0}
                background="secondarySystemBackground"
                clipShape={{ type: "rect", cornerRadius: 18, style: "continuous" }}
              >
                <HStack padding={{ horizontal: 15, vertical: 14 }} alignment="center" spacing={12}>
                  <ZStack
                    frame={{ width: 36, height: 36 }}
                    background="tertiarySystemFill"
                    clipShape={{ type: "rect", cornerRadius: 10, style: "continuous" }}
                  >
                    <Image systemName="server.rack" font={16} foregroundStyle={meta.color} />
                  </ZStack>
                  <VStack alignment="leading" spacing={3} frame={{ maxWidth: Infinity, alignment: "leading" }}>
                    <Text font="subheadline" bold foregroundStyle="label">EC2 实例</Text>
                    <Text font="caption2" foregroundStyle="secondaryLabel" lineLimit={1}>
                      {data?.instance?.instanceId || config.instanceId} · {config.region}
                    </Text>
                  </VStack>
                  <StatusBadge data={data} />
                </HStack>
                <Divider padding={{ horizontal: 16 }} />
                <HStack padding={{ horizontal: 15, vertical: 13 }} alignment="center" spacing={12}>
                  <ZStack
                    frame={{ width: 36, height: 36 }}
                    background="tertiarySystemFill"
                    clipShape={{ type: "rect", cornerRadius: 10, style: "continuous" }}
                  >
                    <Image systemName="waveform.path.ecg" font={16} foregroundStyle="systemTeal" />
                  </ZStack>
                  <VStack alignment="leading" spacing={3} frame={{ maxWidth: Infinity, alignment: "leading" }}>
                    <Text font="subheadline" foregroundStyle="label">统计口径</Text>
                    <Text font="caption2" foregroundStyle="secondaryLabel" lineLimit={2}>
                      CloudWatch · Sum · 300 秒 · UTC 自然月
                    </Text>
                  </VStack>
                  <Text font="caption2" bold foregroundStyle="systemTeal">NetworkOut</Text>
                </HStack>
              </VStack>

              <Text font="caption2" foregroundStyle="tertiaryLabel" padding={{ horizontal: 4 }}>
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

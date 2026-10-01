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
  Text,
  Image,
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
  loadConfig,
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
    saveConfig(nextConfig)
    onSave(nextConfig)
  }

  return (
    <List
      background="systemGroupedBackground"
      navigationTitle="AWS 参数配置"
      navigationBarTitleDisplayMode="inline"
      toolbar={{
        topBarLeading: isConfigReady(currentConfig)
          ? [<Button key="aws-settings-back" action={onCancel} accessibilityLabel="返回"><Image systemName="chevron.backward" /></Button>]
          : undefined,
        topBarTrailing: [<Button key="aws-settings-save" action={handleSave} accessibilityLabel="保存配置"><Image systemName="checkmark" /></Button>]
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
        <Button action={handleSave} buttonStyle="glass" controlSize="large" accessibilityLabel="保存配置并返回">
          <HStack spacing={8} alignment="center">
            <Image systemName="checkmark.circle.fill" foregroundStyle="tintColor" />
            <Text font="headline" foregroundStyle="tintColor">保存并返回</Text>
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

function MetricSummary({ data, threshold }: { data: AwsMonitorData | null; threshold: number }) {
  if (!data) {
    return (
      <HStack padding={16} alignment="center">
        <Text font="caption1" foregroundStyle="secondaryLabel">点击右上角刷新读取 CloudWatch 数据。</Text>
      </HStack>
    )
  }
  const exceeded = data.totalGB >= threshold
  const remaining = Math.max(0, threshold - data.totalGB)
  return (
    <VStack spacing={12} padding={16}>
      <HStack alignment="bottom">
        <VStack alignment="leading" spacing={2}>
          <Text font="caption1" foregroundStyle="secondaryLabel">UTC {data.monthKey} NetworkOut</Text>
          <Text font={34} bold monospacedDigit foregroundStyle={exceeded ? "systemRed" : "label"}>
            {data.totalGB.toFixed(3)} GB
          </Text>
        </VStack>
        <Spacer />
        <VStack alignment="trailing" spacing={2}>
          <Text font="caption2" foregroundStyle="secondaryLabel">{exceeded ? "超出阈值" : "剩余阈值"}</Text>
          <Text font={18} bold monospacedDigit foregroundStyle={exceeded ? "systemRed" : "systemBlue"}>
            {exceeded ? `+${(data.totalGB - threshold).toFixed(3)}` : remaining.toFixed(3)} GB
          </Text>
        </VStack>
      </HStack>
      <ProgressView
        progressViewStyle="linear"
        value={Math.min(1, Math.max(0, data.totalGB / threshold))}
        total={1}
        tint={exceeded ? "systemRed" : data.percentage >= 80 ? "systemOrange" : "systemGreen"}
        frame={{ maxWidth: Infinity, height: 6 }}
      />
      <HStack alignment="center">
        <Text font="caption1" foregroundStyle="secondaryLabel">{Math.min(100, data.percentage).toFixed(1)}% / {threshold} GB</Text>
        <Spacer />
        <Text font="caption2" foregroundStyle="tertiaryLabel">{data.datapointCount} 个 5 分钟数据点</Text>
      </HStack>
    </VStack>
  )
}

function ConsoleView() {
  const [config, setConfig] = useState<AwsAppConfig>(loadConfig())
  const [showSettings, setShowSettings] = useState(!isConfigReady(config))
  const [data, setData] = useState<AwsMonitorData | null>(loadCachedData())
  const [loading, setLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [logs, setLogs] = useState<string[]>([])

  const appendLog = (message: string) => {
    setLogs(previous => [`[${new Date().toLocaleTimeString()}] ${message}`, ...previous.slice(0, 5)])
  }

  const loadData = useCallback(async (nextConfig: AwsAppConfig = config) => {
    if (!isConfigReady(nextConfig)) {
      setShowSettings(true)
      return
    }
    setLoading(true)
    setErrorMessage(null)
    try {
      appendLog("正在读取 AWS CloudWatch 和 EC2...")
      const result = await new AwsService(nextConfig).getMonitorData()
      setData(result)
      saveCachedData(result)
      appendLog(`UTC ${result.monthKey} NetworkOut: ${result.totalGB} GB`)
      appendLog(`EC2: ${statusMeta(result.instance.status).label}`)
    } catch (error: any) {
      const message = error?.message || "AWS 请求失败，请检查 Region、实例 ID 和只读权限"
      setErrorMessage(message)
      appendLog(`错误: ${message}`)
    } finally {
      setLoading(false)
    }
  }, [config])

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
          {errorMessage && (
            <HStack alignment="top" spacing={8} padding={{ horizontal: 12, vertical: 10 }} background="rgba(255, 59, 48, 0.10)">
              <Image systemName="exclamationmark.triangle.fill" font={13} foregroundStyle="systemRed" />
              <Text font="caption1" foregroundStyle="systemRed" lineLimit={4}>{errorMessage}</Text>
            </HStack>
          )}

          <HStack alignment="center">
            <VStack alignment="leading" spacing={3}>
              <Text font="headline" foregroundStyle="label">EC2 NetworkOut</Text>
              <Text font="caption2" foregroundStyle="secondaryLabel">{config.instanceId} · {config.region}</Text>
            </VStack>
            <Spacer />
            <HStack spacing={5} alignment="center">
              <Image systemName={meta.icon} font={13} foregroundStyle={meta.color} />
              <Text font="caption1" bold foregroundStyle={meta.color}>{loading ? "同步中" : meta.label}</Text>
            </HStack>
          </HStack>

          <VStack spacing={0} background="systemBackground" border={{ style: "separator", width: 0.5 }}>
            <MetricSummary data={data} threshold={threshold} />
          </VStack>

          <HStack alignment="center" padding={{ horizontal: 4 }}>
            <Image systemName="clock" font={12} foregroundStyle="secondaryLabel" />
            <Text font="caption2" foregroundStyle="secondaryLabel">最后更新：{formatUpdatedAt(data?.updatedAt)}</Text>
            <Spacer />
            <Text font="caption2" foregroundStyle="secondaryLabel">阈值 {threshold} GB</Text>
          </HStack>

          <VStack spacing={0} background="systemBackground" border={{ style: "separator", width: 0.5 }}>
            <HStack padding={{ horizontal: 16, vertical: 12 }} alignment="center">
              <Image systemName="server.rack" font={16} foregroundStyle="systemBlue" frame={{ width: 24, height: 24 }} />
              <VStack alignment="leading" spacing={2}>
                <Text font="subheadline" foregroundStyle="label">EC2 实例状态</Text>
                <Text font="caption2" foregroundStyle="secondaryLabel">{data?.instance?.instanceId || config.instanceId}</Text>
              </VStack>
              <Spacer />
              <Text font="subheadline" bold foregroundStyle={meta.color}>{meta.label}</Text>
            </HStack>
            <Divider padding={{ leading: 52 }} />
            <HStack padding={{ horizontal: 16, vertical: 12 }} alignment="center">
              <Image systemName="waveform.path.ecg" font={16} foregroundStyle="systemTeal" frame={{ width: 24, height: 24 }} />
              <VStack alignment="leading" spacing={2}>
                <Text font="subheadline" foregroundStyle="label">统计口径</Text>
                <Text font="caption2" foregroundStyle="secondaryLabel">CloudWatch · Sum · 300 秒 · UTC 当月</Text>
              </VStack>
              <Spacer />
              <Text font="caption1" bold foregroundStyle="secondaryLabel">只读</Text>
            </HStack>
          </VStack>

          <VStack alignment="leading" spacing={6} padding={{ horizontal: 4, top: 4 }}>
            <Text font="subheadline" bold foregroundStyle="label">最近活动</Text>
            {logs.length > 0
              ? logs.map((item, index) => <Text key={index} font="caption2" foregroundStyle="secondaryLabel" lineLimit={2}>{item}</Text>)
              : <Text font="caption2" foregroundStyle="secondaryLabel">暂无记录，点击刷新同步。</Text>}
          </VStack>
          <Text font="caption2" foregroundStyle="tertiaryLabel">
            NetworkOut 是实例指标，不等于账单中的所有网络出站计费项。当前月按 UTC 自然月累计，数据可能有 CloudWatch 延迟。
          </Text>
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

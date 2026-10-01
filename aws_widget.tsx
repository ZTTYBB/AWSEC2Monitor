import {
  Widget,
  VStack,
  HStack,
  Text,
  Image,
  Spacer,
  ProgressView,
  Circle
} from "scripting"
import {
  DEFAULT_CONFIG,
  SNAPSHOT_STORAGE_KEY,
  isConfigReady,
  loadConfig
} from "./aws_config"
import { AwsMonitorData, AwsService } from "./aws"

const WIDGET_REFRESH_AFTER_MS = 15 * 60 * 1000

function statusMeta(status: string): { label: string; color: string } {
  switch (status) {
    case "running":
      return { label: "运行中", color: "systemGreen" }
    case "stopped":
      return { label: "已停止", color: "systemIndigo" }
    case "pending":
      return { label: "启动中", color: "systemOrange" }
    case "stopping":
      return { label: "停止中", color: "systemOrange" }
    default:
      return { label: "未知", color: "secondaryLabel" }
  }
}

function readCachedData(): AwsMonitorData | null {
  try {
    if (typeof Storage === "undefined" || !Storage.get) return null
    const raw = Storage.get(SNAPSHOT_STORAGE_KEY)
    if (!raw) return null
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw
    const updatedAt = new Date(parsed.updatedAt)
    if (!Number.isFinite(parsed.totalGB) || Number.isNaN(updatedAt.getTime())) return null
    return { ...parsed, updatedAt } as AwsMonitorData
  } catch {
    return null
  }
}

function saveData(data: AwsMonitorData): void {
  try {
    if (typeof Storage !== "undefined" && Storage.set) {
      Storage.set(SNAPSHOT_STORAGE_KEY, JSON.stringify(data))
    }
  } catch {}
}

function updateLabel(value: Date): string {
  return value.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
}

function present(view: any): void {
  Widget.present(view, {
    policy: "after",
    date: new Date(Date.now() + WIDGET_REFRESH_AFTER_MS)
  })
}

function NotConfiguredView() {
  return (
    <VStack alignment="leading" spacing={6} padding={{ horizontal: 14, vertical: 12 }} widgetBackground="systemBackground">
      <HStack spacing={6} alignment="center">
        <Image systemName="cloud.fill" font={14} foregroundStyle="systemOrange" />
        <Text font="headline" bold>AWS EC2</Text>
      </HStack>
      <Text font="caption1" foregroundStyle="secondaryLabel" lineLimit={3}>请先在 Scripting App 内完成 AWS 只读配置。</Text>
    </VStack>
  )
}

function SmallView({ data }: { data: AwsMonitorData }) {
  const threshold = data.thresholdGB || DEFAULT_CONFIG.trafficThresholdGB
  const meta = statusMeta(data.instance?.status || "unknown")
  const exceeded = data.totalGB >= threshold
  return (
    <VStack alignment="leading" spacing={7} padding={{ horizontal: 12, vertical: 11 }} widgetBackground="systemBackground">
      <HStack alignment="center">
        <HStack spacing={5} alignment="center">
          <Image systemName="cloud.fill" font={12} foregroundStyle="systemOrange" />
          <Text font={captionFont()} bold lineLimit={1}>AWS EC2</Text>
        </HStack>
        <Spacer />
        <Circle fill={meta.color} frame={{ width: 6, height: 6 }} />
      </HStack>
      <VStack alignment="leading" spacing={1}>
        <Text font={10} foregroundStyle="secondaryLabel" lineLimit={1}>UTC {data.monthKey} NetworkOut</Text>
        <Text font={22} bold monospacedDigit foregroundStyle={exceeded ? "systemRed" : "label"} lineLimit={1}>
          {data.totalGB.toFixed(2)} GB
        </Text>
      </VStack>
      <ProgressView
        progressViewStyle="linear"
        value={Math.min(1, Math.max(0, data.totalGB / threshold))}
        total={1}
        tint={exceeded ? "systemRed" : data.percentage >= 80 ? "systemOrange" : "systemGreen"}
        frame={{ maxWidth: Infinity, height: 4 }}
      />
      <HStack alignment="center">
        <Text font={9} foregroundStyle="secondaryLabel" lineLimit={1}>{Math.min(100, data.percentage).toFixed(0)}% / {threshold}G</Text>
        <Spacer />
        <Text font={9} foregroundStyle={meta.color} lineLimit={1}>{meta.label}</Text>
      </HStack>
    </VStack>
  )
}

function MediumView({ data }: { data: AwsMonitorData }) {
  const threshold = data.thresholdGB || DEFAULT_CONFIG.trafficThresholdGB
  const meta = statusMeta(data.instance?.status || "unknown")
  return (
    <VStack alignment="leading" spacing={9} padding={{ horizontal: 15, vertical: 13 }} widgetBackground="systemBackground">
      <HStack alignment="center">
        <HStack spacing={6} alignment="center">
          <Image systemName="cloud.fill" font={14} foregroundStyle="systemOrange" />
          <Text font="headline" bold>AWS EC2 流量</Text>
        </HStack>
        <Spacer />
        <HStack spacing={5} alignment="center">
          <Circle fill={meta.color} frame={{ width: 6, height: 6 }} />
          <Text font="caption1" bold foregroundStyle={meta.color}>{meta.label}</Text>
        </HStack>
      </HStack>
      <HStack alignment="bottom">
        <VStack alignment="leading" spacing={2}>
          <Text font="caption2" foregroundStyle="secondaryLabel">UTC {data.monthKey} NetworkOut</Text>
          <Text font={28} bold monospacedDigit>{data.totalGB.toFixed(3)} GB</Text>
        </VStack>
        <Spacer />
        <VStack alignment="trailing" spacing={2}>
          <Text font="caption2" foregroundStyle="secondaryLabel">阈值</Text>
          <Text font="headline" bold monospacedDigit foregroundStyle="systemBlue">{threshold} GB</Text>
        </VStack>
      </HStack>
      <ProgressView
        progressViewStyle="linear"
        value={Math.min(1, Math.max(0, data.totalGB / threshold))}
        total={1}
        tint={data.totalGB >= threshold ? "systemRed" : "systemGreen"}
        frame={{ maxWidth: Infinity, height: 5 }}
      />
      <HStack alignment="center">
        <Text font={10} foregroundStyle="secondaryLabel">{data.datapointCount} 个 CloudWatch 数据点</Text>
        <Spacer />
        <Text font={10} foregroundStyle="tertiaryLabel">{updateLabel(data.updatedAt)}</Text>
      </HStack>
    </VStack>
  )
}

function LargeView({ data }: { data: AwsMonitorData }) {
  return (
    <VStack alignment="leading" spacing={12} padding={{ horizontal: 17, vertical: 15 }} widgetBackground="systemBackground">
      <MediumView data={data} />
      <HStack spacing={8} alignment="top">
        <Image systemName="info.circle" font={12} foregroundStyle="systemBlue" />
        <Text font={10} foregroundStyle="secondaryLabel" lineLimit={4}>
          NetworkOut 按 CloudWatch 实例指标统计，当前显示 UTC 自然月累计；不代表 AWS 账单全部出站计费项。
        </Text>
      </HStack>
    </VStack>
  )
}

function AccessoryCircularView({ data }: { data: AwsMonitorData }) {
  return (
    <VStack alignment="center" spacing={2} widgetBackground="clear">
      <Text font={11} bold monospacedDigit>{Math.min(100, data.percentage).toFixed(0)}%</Text>
      <Text font={8} foregroundStyle="secondaryLabel">NetworkOut</Text>
    </VStack>
  )
}

function AccessoryRectangularView({ data }: { data: AwsMonitorData }) {
  const meta = statusMeta(data.instance?.status || "unknown")
  return (
    <HStack spacing={7} alignment="center" widgetBackground="clear">
      <VStack alignment="leading" spacing={2}>
        <Text font={12} bold monospacedDigit lineLimit={1}>{data.totalGB.toFixed(2)} GB</Text>
        <Text font={9} foregroundStyle="secondaryLabel" lineLimit={1}>UTC {data.monthKey} / {data.thresholdGB}G</Text>
      </VStack>
      <Spacer />
      <HStack spacing={4} alignment="center">
        <Circle widgetAccentable fill={meta.color} frame={{ width: 5, height: 5 }} />
        <Text font={9} foregroundStyle={meta.color} lineLimit={1}>{meta.label}</Text>
      </HStack>
    </HStack>
  )
}

function AccessoryInlineView({ data }: { data: AwsMonitorData }) {
  return (
    <Text lineLimit={1} monospacedDigit>
      AWS {data.totalGB.toFixed(2)}/{data.thresholdGB}G NetworkOut
    </Text>
  )
}

function presentData(data: AwsMonitorData): void {
  switch (Widget.family) {
    case "accessoryInline":
      present(<AccessoryInlineView data={data} />)
      break
    case "accessoryCircular":
      present(<AccessoryCircularView data={data} />)
      break
    case "accessoryRectangular":
      present(<AccessoryRectangularView data={data} />)
      break
    case "systemMedium":
      present(<MediumView data={data} />)
      break
    case "systemLarge":
      present(<LargeView data={data} />)
      break
    default:
      present(<SmallView data={data} />)
  }
}

function captionFont(): number {
  return 12
}

async function main() {
  try {
    const config = loadConfig()
    if (!isConfigReady(config)) {
      present(<NotConfiguredView />)
      return
    }
    const data = await new AwsService(config).getMonitorData()
    saveData(data)
    presentData(data)
  } catch (error: any) {
    console.error("AWS 小组件加载失败:", error)
    const cached = readCachedData()
    if (cached) {
      presentData(cached)
      return
    }
    present(
      <VStack alignment="leading" spacing={5} padding={{ horizontal: 12, vertical: 11 }} widgetBackground="systemBackground">
        <HStack spacing={6} alignment="center">
          <Image systemName="exclamationmark.triangle.fill" font={12} foregroundStyle="systemRed" />
          <Text font="headline" bold foregroundStyle="systemRed">AWS 获取失败</Text>
        </HStack>
        <Text font="caption2" foregroundStyle="secondaryLabel" lineLimit={3}>请打开 App 检查配置、Region 和 IAM 只读权限。</Text>
      </VStack>
    )
  }
}

main()

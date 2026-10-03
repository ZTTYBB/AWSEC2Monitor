import {
  Widget,
  VStack,
  HStack,
  ZStack,
  Text,
  Image,
  Spacer,
  RoundedRectangle,
  Capsule
} from "scripting"
import {
  DEFAULT_CONFIG,
  SNAPSHOT_STORAGE_KEY,
  isConfigReady,
  loadConfig,
  readStorageValue,
  writeStorageValue
} from "./aws_config"
import { AwsMonitorData, AwsService } from "./aws"
import { getDailyBudget } from "./aws_budget"

const WIDGET_REFRESH_AFTER_MS = 15 * 60 * 1000
const isTransparentWidget = (Widget as any).isTransparentBackground === true

const C = {
  accent: { light: "#FF9500", dark: "#FF9F0A" } as any,
  accentSoft: { light: "rgba(255, 149, 0, 0.12)", dark: "rgba(255, 159, 10, 0.18)" } as any,
  blue: { light: "#3478F6", dark: "#6EA8FE" } as any,
  green: { light: "#198754", dark: "#63D391" } as any,
  red: { light: "#D92D20", dark: "#FF7B72" } as any,
  textPrimary: { light: "#1C1C1E", dark: "#FFFFFF" } as any,
  textSecondary: { light: "rgba(28, 28, 30, 0.66)", dark: "rgba(255, 255, 255, 0.68)" } as any,
  textTertiary: { light: "rgba(28, 28, 30, 0.42)", dark: "rgba(255, 255, 255, 0.44)" } as any,
  card: { light: "#FFFFFF", dark: "#1C1C1E" } as any,
  panel: { light: "rgba(255, 149, 0, 0.06)", dark: "rgba(255, 159, 10, 0.11)" } as any,
  neutralPanel: { light: "rgba(28, 28, 30, 0.055)", dark: "rgba(255, 255, 255, 0.09)" } as any,
  track: { light: "rgba(28, 28, 30, 0.09)", dark: "rgba(255, 255, 255, 0.15)" } as any
}

function statusMeta(status: string): { label: string; color: any } {
  switch (status) {
    case "running":
      return { label: "运行中", color: C.green }
    case "stopped":
      return { label: "已停止", color: C.blue }
    case "pending":
      return { label: "启动中", color: C.accent }
    case "stopping":
      return { label: "停止中", color: C.accent }
    default:
      return { label: "未知", color: C.textTertiary }
  }
}

function usageColor(data: AwsMonitorData): any {
  if (data.statusLevel === "danger" || data.totalGB >= data.thresholdGB) return C.red
  if (data.statusLevel === "warning" || data.percentage >= 80) return C.accent
  return C.green
}

function readCachedData(): AwsMonitorData | null {
  try {
    const raw = readStorageValue(SNAPSHOT_STORAGE_KEY)
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
    writeStorageValue(SNAPSHOT_STORAGE_KEY, JSON.stringify(data))
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

function widgetBackground(): any {
  return isTransparentWidget ? ("clear" as any) : C.card
}

function BrandMark({ size = 28 }: { size?: number }) {
  return (
    <ZStack alignment="center" frame={{ width: size, height: size }}>
      <RoundedRectangle
        cornerRadius={size * 0.28}
        style="continuous"
        fill={C.accentSoft}
        frame={{ width: size, height: size }}
      />
      <Image
        systemName="cloud.fill"
        resizable
        frame={{ width: size * 0.48, height: size * 0.48 }}
        foregroundStyle={C.accent}
      />
    </ZStack>
  )
}

function StatusPill({ status }: { status: string }) {
  const meta = statusMeta(status)
  return (
    <HStack spacing={4} alignment="center">
      <Capsule fill={meta.color} frame={{ width: 6, height: 6 }} />
      <Text font={9} bold foregroundStyle={meta.color} lineLimit={1}>{meta.label}</Text>
    </HStack>
  )
}

function SegmentedUsage({
  progress,
  width,
  height = 5
}: {
  progress: number
  width: number
  height?: number
}) {
  const count = 16
  const gap = height <= 5 ? 2 : 3
  const segmentWidth = Math.max(2, (width - gap * (count - 1)) / count)
  const activeCount = Math.ceil(Math.min(1, Math.max(0, progress)) * count)
  const activeColor = progress >= 1 ? C.red : progress >= 0.8 ? C.accent : C.green
  const segments: any[] = []

  for (let index = 0; index < count; index++) {
    segments.push(
      <RoundedRectangle
        key={index}
        cornerRadius={height / 2}
        style="continuous"
        fill={index < activeCount ? activeColor : C.track}
        frame={{ width: segmentWidth, height }}
      />
    )
    if (index < count - 1) segments.push(<Spacer key={`gap-${index}`} minLength={gap} />)
  }

  return (
    <HStack spacing={0} alignment="center" frame={{ width, height }}>
      {segments}
    </HStack>
  )
}

function MetricTile({
  label,
  value,
  width = 72,
  color = C.textPrimary
}: {
  label: string
  value: string
  width?: number
  color?: any
}) {
  return (
    <ZStack alignment="leading" frame={{ width, height: 46 }}>
      <RoundedRectangle
        cornerRadius={8}
        style="continuous"
        fill={C.neutralPanel}
        frame={{ width, height: 46 }}
      />
      <VStack alignment="leading" spacing={2} padding={{ horizontal: 8, vertical: 7 }} frame={{ width, height: 46 }}>
        <Text font={8} foregroundStyle={C.textSecondary} lineLimit={1}>{label}</Text>
        <Text font={12} bold monospacedDigit foregroundStyle={color} lineLimit={1} minScaleFactor={0.7}>{value}</Text>
      </VStack>
    </ZStack>
  )
}

function UsageHero({
  data,
  width,
  height,
  compact = false
}: {
  data: AwsMonitorData
  width: number
  height: number
  compact?: boolean
}) {
  const color = usageColor(data)
  const valueFont = compact ? 22 : 28
  const progressWidth = Math.max(70, width - (compact ? 24 : 32))

  return (
    <ZStack alignment="leading" frame={{ width, height }}>
      <RoundedRectangle
        cornerRadius={12}
        style="continuous"
        fill={C.panel}
        frame={{ width, height }}
      />
      <VStack alignment="leading" spacing={compact ? 5 : 7} padding={{ horizontal: 12, vertical: 11 }} frame={{ width, height }}>
        <HStack alignment="center">
          <VStack alignment="leading" spacing={1}>
            <Text font={9} foregroundStyle={C.textSecondary} lineLimit={1}>本月 NetworkOut</Text>
            <Text font={valueFont} bold monospacedDigit foregroundStyle={color} lineLimit={1} minScaleFactor={0.72}>
              {data.totalGB.toFixed(compact ? 1 : 2)} GB
            </Text>
          </VStack>
          <Spacer />
          <VStack alignment="trailing" spacing={1}>
            <Text font={8} foregroundStyle={C.textSecondary}>已使用</Text>
            <Text font={12} bold monospacedDigit foregroundStyle={color}>{Math.min(100, data.percentage).toFixed(0)}%</Text>
          </VStack>
        </HStack>
        <SegmentedUsage progress={data.totalGB / data.thresholdGB} width={progressWidth} height={compact ? 5 : 6} />
        <HStack alignment="center">
          <Text font={8} foregroundStyle={C.textSecondary} lineLimit={1}>阈值 {data.thresholdGB} GB</Text>
          <Spacer />
          <Text font={8} foregroundStyle={C.textTertiary} lineLimit={1}>剩余 {data.remainingGB.toFixed(1)} GB</Text>
        </HStack>
      </VStack>
    </ZStack>
  )
}

function NotConfiguredView() {
  return (
    <VStack
      alignment="leading"
      spacing={9}
      padding={{ horizontal: 14, vertical: 13 }}
      widgetBackground={widgetBackground()}
    >
      <HStack spacing={8} alignment="center">
        <BrandMark size={28} />
        <VStack alignment="leading" spacing={1}>
          <Text font="headline" bold>AWS EC2</Text>
          <Text font={9} foregroundStyle={C.textSecondary}>等待完成监控配置</Text>
        </VStack>
      </HStack>
      <ZStack alignment="leading" frame={{ maxWidth: Infinity, height: 42 }}>
        <RoundedRectangle cornerRadius={8} style="continuous" fill={C.neutralPanel} frame={{ maxWidth: Infinity, height: 42 }} />
        <Text font={10} foregroundStyle={C.textSecondary} padding={{ horizontal: 10 }}>请在 Scripting App 的设置页添加 AWS 凭据和实例 ID。</Text>
      </ZStack>
    </VStack>
  )
}

function SmallView({ data }: { data: AwsMonitorData }) {
  const meta = statusMeta(data.instance?.status || "unknown")
  const budget = getDailyBudget(data)
  return (
    <VStack
      alignment="leading"
      spacing={8}
      padding={{ horizontal: 12, vertical: 11 }}
      widgetBackground={widgetBackground()}
    >
      <HStack alignment="center">
        <BrandMark size={25} />
        <VStack alignment="leading" spacing={1}>
          <Text font={11} bold lineLimit={1}>AWS EC2</Text>
          <Text font={8} foregroundStyle={C.textSecondary} lineLimit={1}>UTC {data.monthKey}</Text>
        </VStack>
        <Spacer />
        <Capsule fill={meta.color} frame={{ width: 7, height: 7 }} />
      </HStack>
      <UsageHero data={data} width={131} height={78} compact />
      <HStack alignment="center">
        <Text font={8} monospacedDigit foregroundStyle={C.textSecondary} lineLimit={1} minScaleFactor={0.7}>
          {budget ? `日均 ${budget.dailyAvailableGB.toFixed(2)} GB` : "日均 --"}
        </Text>
        <Spacer />
        <Text font={8} foregroundStyle={C.textTertiary} lineLimit={1}>{updateLabel(data.updatedAt)}</Text>
      </HStack>
    </VStack>
  )
}

function MediumView({ data }: { data: AwsMonitorData }) {
  const budget = getDailyBudget(data)
  return (
    <VStack
      alignment="leading"
      spacing={9}
      padding={{ horizontal: 13, vertical: 12 }}
      widgetBackground={widgetBackground()}
    >
      <HStack alignment="center">
        <BrandMark size={27} />
        <VStack alignment="leading" spacing={1}>
          <Text font="headline" bold lineLimit={1}>AWS EC2 流量</Text>
          <Text font={8} foregroundStyle={C.textSecondary} lineLimit={1}>UTC {data.monthKey} · CloudWatch NetworkOut</Text>
        </VStack>
        <Spacer />
        <StatusPill status={data.instance?.status || "unknown"} />
      </HStack>
      <HStack spacing={8} alignment="top">
        <UsageHero data={data} width={137} height={96} />
        <VStack alignment="leading" spacing={7}>
          <HStack spacing={6}>
            <MetricTile label="剩余流量" value={`${data.remainingGB.toFixed(1)}G`} width={70} color={usageColor(data)} />
            <MetricTile label="日均可用" value={budget ? `${budget.dailyAvailableGB.toFixed(2)} GB` : "--"} width={70} />
          </HStack>
          <ZStack alignment="leading" frame={{ width: 146, height: 38 }}>
            <RoundedRectangle cornerRadius={8} style="continuous" fill={C.neutralPanel} frame={{ width: 146, height: 38 }} />
            <VStack alignment="leading" spacing={1} padding={{ horizontal: 8, vertical: 6 }} frame={{ width: 146, height: 38 }}>
              <Text font={8} foregroundStyle={C.textSecondary} lineLimit={1} minScaleFactor={0.8}>
                {budget ? `实例状态 · UTC 剩${budget.remainingDays}天` : "实例状态 · 待更新"}
              </Text>
              <Text font={10} bold foregroundStyle={statusMeta(data.instance?.status || "unknown").color} lineLimit={1}>
                {statusMeta(data.instance?.status || "unknown").label} · {updateLabel(data.updatedAt)}
              </Text>
            </VStack>
          </ZStack>
        </VStack>
      </HStack>
    </VStack>
  )
}

function LargeView({ data }: { data: AwsMonitorData }) {
  const instance = data.instance?.instanceId || "未读取实例 ID"
  const budget = getDailyBudget(data)
  return (
    <VStack
      alignment="leading"
      spacing={10}
      padding={{ horizontal: 15, vertical: 14 }}
      widgetBackground={widgetBackground()}
    >
      <HStack alignment="center">
        <BrandMark size={30} />
        <VStack alignment="leading" spacing={1}>
          <Text font={16} bold lineLimit={1}>AWS EC2 流量看板</Text>
          <Text font={9} foregroundStyle={C.textSecondary} lineLimit={1} minScaleFactor={0.7}>
            本月累计 · UTC {data.monthKey} · 更新 {updateLabel(data.updatedAt)}
          </Text>
        </VStack>
        <Spacer />
        <StatusPill status={data.instance?.status || "unknown"} />
      </HStack>
      <UsageHero data={data} width={299} height={105} />
      <HStack spacing={8}>
        <MetricTile label="剩余流量" value={`${data.remainingGB.toFixed(2)} GB`} width={145} color={usageColor(data)} />
        <MetricTile
          label={budget ? `日均可用 · UTC 剩${budget.remainingDays}天` : "日均可用 · 待更新"}
          value={budget ? `${budget.dailyAvailableGB.toFixed(2)} GB` : "--"}
          width={145}
        />
      </HStack>
      <ZStack alignment="leading" frame={{ width: 299, height: 40 }}>
        <RoundedRectangle cornerRadius={8} style="continuous" fill={C.neutralPanel} frame={{ width: 299, height: 40 }} />
        <VStack alignment="leading" spacing={2} padding={{ horizontal: 9, vertical: 6 }} frame={{ width: 299, height: 40 }}>
          <HStack alignment="center">
            <Image systemName="server.rack" resizable frame={{ width: 11, height: 11 }} foregroundStyle={C.blue} />
            <Text font={8} foregroundStyle={C.textSecondary}>监控实例</Text>
            <Spacer />
            <Text font={9} monospacedDigit foregroundStyle={C.textPrimary} lineLimit={1}>{instance}</Text>
          </HStack>
          <Text font={8} foregroundStyle={C.textTertiary} lineLimit={1}>
            仅统计 AWS/EC2 的 CloudWatch NetworkOut，不等同于完整账单出站项。
          </Text>
        </VStack>
      </ZStack>
    </VStack>
  )
}

function AccessoryCircularView({ data }: { data: AwsMonitorData }) {
  const color = usageColor(data)
  return (
    <VStack alignment="center" spacing={1}>
      <Text font={15} bold monospacedDigit foregroundStyle={color}>{Math.min(100, data.percentage).toFixed(0)}%</Text>
      <Text font={8} foregroundStyle={C.textSecondary} lineLimit={1}>出站流量</Text>
    </VStack>
  )
}

function AccessoryRectangularView({ data }: { data: AwsMonitorData }) {
  const meta = statusMeta(data.instance?.status || "unknown")
  return (
    <VStack alignment="leading" spacing={4} frame={{ maxWidth: Infinity }}>
      <HStack alignment="center">
        <Text font={10} bold lineLimit={1}>AWS EC2</Text>
        <Spacer />
        <StatusPill status={data.instance?.status || "unknown"} />
      </HStack>
      <HStack alignment="center">
        <VStack alignment="leading" spacing={1}>
          <Text font={13} bold monospacedDigit lineLimit={1}>{data.totalGB.toFixed(2)} GB</Text>
          <Text font={8} foregroundStyle={C.textSecondary} lineLimit={1}>/{data.thresholdGB}G · {data.monthKey}</Text>
        </VStack>
        <Spacer />
        <Capsule fill={meta.color} frame={{ width: 7, height: 7 }} />
      </HStack>
    </VStack>
  )
}

function AccessoryInlineView({ data }: { data: AwsMonitorData }) {
  return (
    <Text lineLimit={1} monospacedDigit>
      AWS {data.totalGB.toFixed(1)}/{data.thresholdGB}G · {Math.min(100, data.percentage).toFixed(0)}%
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
    case "systemExtraLarge":
      present(<LargeView data={data} />)
      break
    default:
      present(<SmallView data={data} />)
  }
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
      <VStack
        alignment="leading"
        spacing={9}
        padding={{ horizontal: 14, vertical: 13 }}
        widgetBackground={widgetBackground()}
      >
        <HStack spacing={8} alignment="center">
          <ZStack alignment="center" frame={{ width: 28, height: 28 }}>
            <RoundedRectangle cornerRadius={8} style="continuous" fill={C.red} frame={{ width: 28, height: 28 }} />
            <Image systemName="exclamationmark.triangle.fill" resizable frame={{ width: 13, height: 13 }} foregroundStyle="#FFFFFF" />
          </ZStack>
          <VStack alignment="leading" spacing={1}>
            <Text font="headline" bold foregroundStyle={C.red}>AWS 获取失败</Text>
            <Text font={9} foregroundStyle={C.textSecondary}>请检查配置、Region 和 IAM 查询权限。</Text>
          </VStack>
        </HStack>
      </VStack>
    )
  }
}

main()

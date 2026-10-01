/**
 * AWS EC2 monitor configuration.
 *
 * Credentials are stored in Scripting Storage because this script runs
 * directly on the device. Use a dedicated read-only IAM principal and rotate
 * it regularly; Storage is not an application-level secret vault.
 */
import { Storage } from "scripting"

export const APP_VERSION = "1.0.0"

export interface AwsAppConfig {
  accessKeyId: string
  secretAccessKey: string
  sessionToken: string
  region: string
  instanceId: string
  trafficThresholdGB: number
}

export const DEFAULT_CONFIG: AwsAppConfig = {
  accessKeyId: "",
  secretAccessKey: "",
  sessionToken: "",
  region: "us-east-1",
  instanceId: "",
  trafficThresholdGB: 100
}

export const STORAGE_KEY = "aws_ec2_monitor_config_v1"
export const SNAPSHOT_STORAGE_KEY = "aws_ec2_monitor_snapshot_v1"

function normalizeConfig(value: unknown): AwsAppConfig {
  const source = value && typeof value === "object" ? value as Partial<AwsAppConfig> : {}
  const threshold = Number(source.trafficThresholdGB)
  return {
    accessKeyId: typeof source.accessKeyId === "string" ? source.accessKeyId : DEFAULT_CONFIG.accessKeyId,
    secretAccessKey: typeof source.secretAccessKey === "string" ? source.secretAccessKey : DEFAULT_CONFIG.secretAccessKey,
    sessionToken: typeof source.sessionToken === "string" ? source.sessionToken : DEFAULT_CONFIG.sessionToken,
    region: typeof source.region === "string" && source.region.trim()
      ? source.region
      : DEFAULT_CONFIG.region,
    instanceId: typeof source.instanceId === "string" ? source.instanceId : DEFAULT_CONFIG.instanceId,
    trafficThresholdGB: Number.isFinite(threshold) && threshold > 0
      ? threshold
      : DEFAULT_CONFIG.trafficThresholdGB
  }
}

export function loadConfig(): AwsAppConfig {
  try {
    const saved = Storage.get(STORAGE_KEY)
    if (saved) {
      const parsed = typeof saved === "string" ? JSON.parse(saved) : saved
      return normalizeConfig(parsed)
    }
  } catch (error) {
    console.error("读取 AWS 配置失败:", error)
  }
  return normalizeConfig(DEFAULT_CONFIG)
}

export function saveConfig(config: AwsAppConfig): void {
  try {
    Storage.set(STORAGE_KEY, JSON.stringify(config))
  } catch (error) {
    console.error("保存 AWS 配置失败:", error)
  }
}

export function isConfigReady(config: AwsAppConfig): boolean {
  return Boolean(
    config.accessKeyId.trim() &&
    config.secretAccessKey.trim() &&
    config.region.trim() &&
    config.instanceId.trim()
  )
}

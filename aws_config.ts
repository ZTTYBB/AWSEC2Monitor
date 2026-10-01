/**
 * AWS EC2 monitor configuration.
 *
 * Credentials are stored in Scripting Storage because this script runs
 * directly on the device. Use a dedicated read-only IAM principal and rotate
 * it regularly; Storage is not an application-level secret vault.
 */
import { Storage } from "scripting"

export const APP_VERSION = "1.0.1"

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

// Keep the original key stable so upgrades do not create a new empty config
// namespace in Scripting Storage.
export const STORAGE_KEY = "aws_ec2_monitor_config_v1"
const COMPAT_STORAGE_KEYS = ["aws_ec2_monitor_config"] as const
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
  const keys = [STORAGE_KEY, ...COMPAT_STORAGE_KEYS]
  for (const key of keys) {
    const config = parseStoredConfig(readStorageValue(key))
    if (config) return config
  }
  return normalizeConfig(DEFAULT_CONFIG)
}

function parseStoredConfig(value: unknown): AwsAppConfig | null {
  if (!value) return null
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value
    const config = normalizeConfig(parsed)
    return isConfigReady(config) ? config : null
  } catch {
    return null
  }
}

function readStorageValue(key: string): unknown {
  try {
    const storage = Storage as any
    if (typeof storage === "undefined" || typeof storage.get !== "function") return null
    return storage.get(key)
  } catch (error) {
    console.error(`读取 AWS 配置失败 (${key}):`, error)
    return null
  }
}

function sameConfig(left: AwsAppConfig, right: AwsAppConfig): boolean {
  return (
    left.accessKeyId === right.accessKeyId &&
    left.secretAccessKey === right.secretAccessKey &&
    left.sessionToken === right.sessionToken &&
    left.region === right.region &&
    left.instanceId === right.instanceId &&
    left.trafficThresholdGB === right.trafficThresholdGB
  )
}

export function saveConfig(config: AwsAppConfig): boolean {
  const normalized = normalizeConfig(config)
  const payload = JSON.stringify(normalized)
  try {
    const storage = Storage as any
    if (typeof storage === "undefined" || typeof storage.set !== "function") return false
    storage.set(STORAGE_KEY, payload)

    // Also write the temporary key used by the previous AWS build.
    storage.set(COMPAT_STORAGE_KEYS[0], payload)
    const saved = parseStoredConfig(storage.get(STORAGE_KEY))
    return Boolean(saved && sameConfig(saved, normalized))
  } catch (error) {
    console.error("保存 AWS 配置失败:", error)
    return false
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

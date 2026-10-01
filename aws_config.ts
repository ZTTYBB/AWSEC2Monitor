/**
 * AWS EC2 monitor configuration.
 *
 * Credentials are stored in Scripting Storage because this script runs
 * directly on the device. Use a dedicated read-only IAM principal and rotate
 * it regularly; Storage is not an application-level secret vault.
 */
import { Storage } from "scripting"

export const APP_VERSION = "1.0.6"

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

// Keep the original key stable so upgrades do not create a new Scripting
// Storage namespace. The unversioned key is compatibility data and is read
// only.
export const STORAGE_KEY = "aws_ec2_monitor_config_v1"
const LEGACY_STORAGE_KEYS = ["aws_ec2_monitor_config"] as const
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
  // Prefer the current key. Only fall back when it does not contain a
  // complete saved credential set, so an empty/partial primary value cannot
  // hide a valid configuration from an older build.
  const primaryConfig = parseStoredConfig(readStorageValue(STORAGE_KEY))
  if (primaryConfig) return primaryConfig

  for (const key of LEGACY_STORAGE_KEYS) {
    const legacyConfig = parseStoredConfig(readStorageValue(key))
    if (legacyConfig) return legacyConfig
  }

  return normalizeConfig(DEFAULT_CONFIG)
}

function parseStoredConfig(value: unknown): AwsAppConfig | null {
  if (!value) return null
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null

    // Instance ID is intentionally optional. Credentials and Region are the
    // minimum persisted set, so an empty object cannot mask legacy data.
    const source = parsed as Partial<AwsAppConfig>
    if (
      typeof source.accessKeyId !== "string" ||
      !source.accessKeyId.trim() ||
      typeof source.secretAccessKey !== "string" ||
      !source.secretAccessKey.trim() ||
      typeof source.region !== "string" ||
      !source.region.trim()
    ) {
      return null
    }

    return normalizeConfig(parsed)
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

/** 按 Scripting 原生同步方式保存配置，不读取 Storage.set 返回值。 */
export function saveConfig(config: AwsAppConfig): AwsAppConfig {
  const normalized = normalizeConfig(config)
  try {
    if (typeof Storage === "undefined" || typeof Storage.set !== "function") {
      throw new Error("Scripting Storage.set 不可用")
    }
    Storage.set(STORAGE_KEY, JSON.stringify(normalized))
    return normalized
  } catch (error) {
    console.error("保存 AWS 配置失败:", error)
    throw error instanceof Error ? error : new Error("保存 AWS 配置失败")
  }
}

export function hasCredentials(config: AwsAppConfig): boolean {
  return Boolean(config.accessKeyId.trim() && config.secretAccessKey.trim())
}

export function hasRegion(config: AwsAppConfig): boolean {
  return Boolean(config.region.trim())
}

export function hasMonitorTarget(config: AwsAppConfig): boolean {
  return Boolean(config.instanceId.trim())
}

export function isConfigReady(config: AwsAppConfig): boolean {
  return hasCredentials(config) && hasRegion(config) && hasMonitorTarget(config)
}

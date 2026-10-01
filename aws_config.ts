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

export const STORAGE_KEY = "aws_ec2_monitor_config"
const LEGACY_STORAGE_KEYS = ["aws_ec2_monitor_config_v1"] as const
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
  return loadConfigSync()
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

function loadConfigSync(): AwsAppConfig {
  const keys = [STORAGE_KEY, ...LEGACY_STORAGE_KEYS]
  for (const key of keys) {
    const config = parseStoredConfig(readStorageValue(key))
    if (config) return config
  }
  return normalizeConfig(DEFAULT_CONFIG)
}

/**
 * Supports both current Scripting Storage implementations and builds where
 * Storage methods return promises. Awaiting a plain value is harmless.
 */
export async function loadConfigAsync(): Promise<AwsAppConfig> {
  const keys = [STORAGE_KEY, ...LEGACY_STORAGE_KEYS]
  for (const key of keys) {
    try {
      const storage = Storage as any
      if (typeof storage === "undefined" || typeof storage.get !== "function") continue
      const config = parseStoredConfig(await storage.get(key))
      if (config) return config
    } catch (error) {
      console.error(`异步读取 AWS 配置失败 (${key}):`, error)
    }
  }
  return normalizeConfig(DEFAULT_CONFIG)
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

export async function saveConfig(config: AwsAppConfig): Promise<boolean> {
  const normalized = normalizeConfig(config)
  const payload = JSON.stringify(normalized)
  try {
    const storage = Storage as any
    if (typeof storage === "undefined" || typeof storage.set !== "function") return false
    await storage.set(STORAGE_KEY, payload)

    // Keep the old key readable during package upgrades and verify the write.
    await storage.set(LEGACY_STORAGE_KEYS[0], payload)
    const saved = parseStoredConfig(await storage.get(STORAGE_KEY))
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

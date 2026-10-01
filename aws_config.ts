/**
 * AWS EC2 monitor configuration.
 *
 * Credentials are stored in Scripting Storage because this script runs
 * directly on the device. Use a dedicated read-only IAM principal and rotate
 * it regularly; Storage is not an application-level secret vault.
 */
// The Scripting entry point exposes Storage as a runtime global. Keep the
// module namespace only as a compatibility fallback for older runtimes.
import * as ScriptingModule from "scripting"

export const APP_VERSION = "1.1.1"

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

type StorageLike = {
  get?: (key: string) => unknown
  set?: (key: string, value: string) => unknown
}

function getGlobalStorage(): StorageLike | null {
  try {
    // This is the same access pattern used by Aliyun's actual index.tsx.
    if (typeof Storage !== "undefined" && Storage) {
      return Storage as unknown as StorageLike
    }
  } catch {}

  try {
    const globalObject = typeof globalThis !== "undefined" ? globalThis as any : null
    return globalObject?.Storage || null
  } catch {
    return null
  }
}

function getStorageCandidates(): StorageLike[] {
  const candidates: StorageLike[] = []
  const add = (candidate: unknown) => {
    if ((typeof candidate !== "object" && typeof candidate !== "function") || !candidate) return
    if (!candidates.includes(candidate as StorageLike)) {
      candidates.push(candidate as StorageLike)
    }
  }

  add(getGlobalStorage())
  try {
    // Namespace access is safe even when this runtime does not export Storage.
    add((ScriptingModule as any)?.Storage)
  } catch {}
  return candidates
}

export function readStorageValue(key: string): unknown {
  let lastError: unknown = null
  for (const storage of getStorageCandidates()) {
    const getter = storage.get
    if (typeof getter !== "function") continue
    try {
      return getter.call(storage, key)
    } catch (error) {
      lastError = error
    }
  }
  if (lastError) {
    console.error(`读取 AWS 配置失败 (${key}):`, lastError)
  }
  return null
}

/**
 * Use the global Storage first, matching Aliyun's entry point. The method is
 * invoked directly so a real runtime error is preserved instead of being
 * mistaken for an unsupported API by a preflight type check.
 */
export function writeStorageValue(key: string, value: string): void {
  let lastError: unknown = null
  let foundSetter = false

  for (const storage of getStorageCandidates()) {
    const setter = storage.set
    if (typeof setter !== "function") continue
    foundSetter = true
    try {
      setter.call(storage, key, value)
      return
    } catch (error) {
      // Do not hide a real error from the active global Storage behind a
      // different module namespace.
      lastError = error
      break
    }
  }

  if (lastError) {
    throw lastError instanceof Error ? lastError : new Error(String(lastError))
  }
  if (!foundSetter) {
    throw new Error("Scripting Storage 未提供可用的 set 方法")
  }
}

export function saveConfig(config: AwsAppConfig): AwsAppConfig {
  const normalized = normalizeConfig(config)
  try {
    writeStorageValue(STORAGE_KEY, JSON.stringify(normalized))
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

import { AwsAppConfig, DEFAULT_CONFIG } from "./aws_config"
import {
  bytesToHex,
  hmacSha256Bytes,
  sha256Hex,
  utf8Bytes
} from "./aws_crypto"

const BYTES_PER_GB = 1024 * 1024 * 1024
const CLOUDWATCH_PERIOD_SECONDS = 300

export type AwsInstanceStatus = "running" | "stopped" | "pending" | "stopping" | "unknown"

export interface AwsInstanceInfo {
  instanceId: string
  status: AwsInstanceStatus
}

export interface AwsTrafficResult {
  monthKey: string
  totalBytes: number
  totalGB: number
  thresholdGB: number
  remainingGB: number
  percentage: number
  statusLevel: "normal" | "warning" | "danger"
  datapointCount: number
  updatedAt: Date
}

export interface AwsMonitorData extends AwsTrafficResult {
  instance: AwsInstanceInfo
}

interface QueryParams {
  [key: string]: string | number | boolean | undefined
}

function percentEncode(value: string): string {
  return encodeURIComponent(value)
    .replace(/!/g, "%21")
    .replace(/'/g, "%27")
    .replace(/\(/g, "%28")
    .replace(/\)/g, "%29")
    .replace(/\*/g, "%2A")
}

function queryString(params: QueryParams): string {
  return Object.keys(params)
    .filter(key => params[key] !== undefined)
    .sort()
    .map(key => `${percentEncode(key)}=${percentEncode(String(params[key]))}`)
    .join("&")
}

function canonicalHeaderValue(value: string): string {
  return value.trim().replace(/\s+/g, " ")
}

function awsDate(date: Date): { short: string; long: string } {
  const iso = date.toISOString().replace(/\.\d{3}Z$/, "Z")
  return {
    short: iso.slice(0, 10).replace(/-/g, ""),
    long: iso.replace(/[:-]/g, "")
  }
}

function deriveSigningKey(secret: string, date: string, region: string, service: string): number[] {
  const dateKey = hmacSha256Bytes(
    utf8Bytes(`AWS4${secret}`),
    utf8Bytes(date)
  )
  const regionKey = hmacSha256Bytes(dateKey, utf8Bytes(region))
  const serviceKey = hmacSha256Bytes(regionKey, utf8Bytes(service))
  return hmacSha256Bytes(serviceKey, utf8Bytes("aws4_request"))
}

export interface AwsSigV4Input {
  endpoint: string
  service: string
  region: string
  accessKeyId: string
  secretAccessKey: string
  sessionToken?: string
  body: string
  timestamp: Date
}

/**
 * Build the headers for an AWS Query API POST request.
 * Keeping this pure makes the SigV4 date, canonical request, and signature
 * independently testable without sending a request or handling credentials.
 */
export function buildAwsSigV4Headers(input: AwsSigV4Input): Record<string, string> {
  const contentType = "application/x-www-form-urlencoded"
  const now = awsDate(input.timestamp)
  const sessionToken = input.sessionToken?.trim()
  const signedHeaderEntries: [string, string][] = [
    ["content-type", contentType],
    ["host", input.endpoint],
    ["x-amz-date", now.long]
  ]
  if (sessionToken) {
    signedHeaderEntries.push(["x-amz-security-token", sessionToken])
  }
  signedHeaderEntries.sort(([a], [b]) => a.localeCompare(b))

  const canonicalHeaders = signedHeaderEntries
    .map(([key, value]) => `${key}:${canonicalHeaderValue(value)}\n`)
    .join("")
  const signedHeaders = signedHeaderEntries.map(([key]) => key).join(";")
  const canonicalRequest = [
    "POST",
    "/",
    "",
    canonicalHeaders,
    signedHeaders,
    sha256Hex(input.body)
  ].join("\n")
  const scope = `${now.short}/${input.region}/${input.service}/aws4_request`
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    now.long,
    scope,
    sha256Hex(canonicalRequest)
  ].join("\n")
  const signingKey = deriveSigningKey(
    input.secretAccessKey.trim(),
    now.short,
    input.region,
    input.service
  )
  const signature = bytesToHex(hmacSha256Bytes(signingKey, utf8Bytes(stringToSign)))

  const headers: Record<string, string> = {
    "Content-Type": contentType,
    "X-Amz-Date": now.long,
    Authorization: `AWS4-HMAC-SHA256 Credential=${input.accessKeyId.trim()}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`
  }
  if (sessionToken) headers["X-Amz-Security-Token"] = sessionToken
  return headers
}

async function awsQueryRequest(
  endpoint: string,
  service: string,
  action: string,
  config: AwsAppConfig,
  params: QueryParams
): Promise<string> {
  const method = "POST"
  const body = queryString({
    Action: action,
    Version: service === "monitoring" ? "2010-08-01" : "2016-11-15",
    ...params
  })
  const headers = buildAwsSigV4Headers({
    endpoint,
    service,
    region: config.region,
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    sessionToken: config.sessionToken,
    body,
    timestamp: new Date()
  })

  const response = await fetch(`https://${endpoint}/`, {
    method,
    headers,
    body
  })
  const text = await response.text()
  if (!response.ok) {
    throw new Error(`AWS ${action} 请求失败 (${response.status}): ${extractAwsError(text)}`)
  }
  if (/<ErrorResponse[\s>]/i.test(text)) {
    throw new Error(`AWS ${action} 请求失败: ${extractAwsError(text)}`)
  }
  return text
}

function xmlDecode(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
}

function firstXmlText(xml: string, tag: string): string | undefined {
  const match = xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "i"))
  return match ? xmlDecode(match[1].trim()) : undefined
}

function allXmlMemberText(xml: string): string[] {
  return Array.from(xml.matchAll(/<member(?:\s[^>]*)?>([\s\S]*?)<\/member>/gi))
    .map(match => xmlDecode(match[1].trim()))
}

function extractAwsError(xml: string): string {
  const code = firstXmlText(xml, "Code")
  const message = firstXmlText(xml, "Message")
  if (code && message) return `${code}: ${message}`
  return message || code || "未知 AWS API 错误"
}

function monthStartUtc(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
}

function monthKeyUtc(now: Date): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`
}

function awsEndpoint(service: string, region: string): string {
  const suffix = region.startsWith("cn-") ? "amazonaws.com.cn" : "amazonaws.com"
  return `${service}.${region}.${suffix}`
}

function trafficStatus(totalGB: number, thresholdGB: number): "normal" | "warning" | "danger" {
  if (totalGB >= thresholdGB) return "danger"
  if (totalGB >= thresholdGB * 0.8) return "warning"
  return "normal"
}

function parseNetworkOutValues(xml: string): number[] {
  const idPos = xml.search(/<Id>\s*networkout\s*<\/Id>/i)
  if (idPos < 0) {
    const match = xml.match(/<Values(?:\s[^>]*)?>([\s\S]*?)<\/Values>/i)
    if (!match) return []
    return allXmlMemberText(match[1])
      .map(value => Number(value))
      .filter(value => Number.isFinite(value) && value >= 0)
  }

  const beforeSlice = xml.slice(0, idPos)
  const lastValuesStart = beforeSlice.lastIndexOf("<Values")
  const lastValuesEnd = beforeSlice.lastIndexOf("</Values>")

  const afterSlice = xml.slice(idPos)
  const nextValuesStart = afterSlice.indexOf("<Values")
  const nextValuesEnd = afterSlice.indexOf("</Values>")

  let valuesContent = ""

  const distBefore = (lastValuesEnd !== -1 && lastValuesStart !== -1) ? (idPos - lastValuesEnd) : Infinity
  const distAfter = (nextValuesStart !== -1 && nextValuesEnd !== -1) ? nextValuesStart : Infinity

  if (distBefore < distAfter && distBefore < 100000) {
    valuesContent = beforeSlice.slice(lastValuesStart, lastValuesEnd)
  } else if (distAfter !== Infinity) {
    valuesContent = afterSlice.slice(nextValuesStart, nextValuesEnd)
  } else {
    const match = xml.match(/<Values(?:\s[^>]*)?>([\s\S]*?)<\/Values>/i)
    if (match) valuesContent = match[1]
  }

  return allXmlMemberText(valuesContent)
    .map(value => Number(value))
    .filter(value => Number.isFinite(value) && value >= 0)
}

export class AwsService {
  private config: AwsAppConfig

  constructor(config: AwsAppConfig = DEFAULT_CONFIG) {
    this.config = config
  }

  async getMonthlyNetworkOut(now = new Date()): Promise<AwsTrafficResult> {
    const start = monthStartUtc(now)
    const end = now
    const endpoint = awsEndpoint("monitoring", this.config.region)
    let nextToken: string | undefined
    let totalBytes = 0
    let datapointCount = 0
    let pageCount = 0

    do {
      const xml = await awsQueryRequest(endpoint, "monitoring", "GetMetricData", this.config, {
        StartTime: start.toISOString(),
        EndTime: end.toISOString(),
        ScanBy: "TimestampAscending",
        "MetricDataQueries.member.1.Id": "networkout",
        "MetricDataQueries.member.1.ReturnData": true,
        "MetricDataQueries.member.1.MetricStat.Metric.Namespace": "AWS/EC2",
        "MetricDataQueries.member.1.MetricStat.Metric.MetricName": "NetworkOut",
        "MetricDataQueries.member.1.MetricStat.Metric.Dimensions.member.1.Name": "InstanceId",
        "MetricDataQueries.member.1.MetricStat.Metric.Dimensions.member.1.Value": this.config.instanceId.trim(),
        "MetricDataQueries.member.1.MetricStat.Period": CLOUDWATCH_PERIOD_SECONDS,
        "MetricDataQueries.member.1.MetricStat.Stat": "Sum",
        "MetricDataQueries.member.1.MetricStat.Metric.Unit": "Bytes",
        MaxDatapoints: 100800,
        NextToken: nextToken
      })
      const values = parseNetworkOutValues(xml)
      totalBytes += values.reduce((sum, value) => sum + value, 0)
      datapointCount += values.length
      nextToken = firstXmlText(xml, "NextToken")
      pageCount++
      if (nextToken && pageCount >= 20) {
        throw new Error("CloudWatch 返回页数超过安全上限，未使用不完整的月度累计值")
      }
    } while (nextToken)

    const totalGB = Number((totalBytes / BYTES_PER_GB).toFixed(3))
    const thresholdGB = Number.isFinite(this.config.trafficThresholdGB) && this.config.trafficThresholdGB > 0
      ? this.config.trafficThresholdGB
      : DEFAULT_CONFIG.trafficThresholdGB
    const remainingGB = Math.max(0, Number((thresholdGB - totalGB).toFixed(3)))
    const percentage = Number(Math.min(100, (totalGB / thresholdGB) * 100).toFixed(1))

    return {
      monthKey: monthKeyUtc(now),
      totalBytes,
      totalGB,
      thresholdGB,
      remainingGB,
      percentage,
      statusLevel: trafficStatus(totalGB, thresholdGB),
      datapointCount,
      updatedAt: now
    }
  }

  async getInstanceStatus(): Promise<AwsInstanceInfo> {
    const endpoint = awsEndpoint("ec2", this.config.region)
    const xml = await awsQueryRequest(endpoint, "ec2", "DescribeInstances", this.config, {
      "InstanceId.1": this.config.instanceId.trim()
    })
    const instanceId = firstXmlText(xml, "instanceId") || this.config.instanceId.trim()
    const state = (firstXmlText(xml, "name") || "").toLowerCase()
    const status: AwsInstanceStatus =
      state === "running" || state === "stopped" || state === "pending" || state === "stopping"
        ? state
        : "unknown"
    return { instanceId, status }
  }

  async getMonitorData(now = new Date()): Promise<AwsMonitorData> {
    const traffic = await this.getMonthlyNetworkOut(now)
    let instance: AwsInstanceInfo = {
      instanceId: this.config.instanceId.trim(),
      status: "unknown"
    }
    try {
      instance = await this.getInstanceStatus()
    } catch (error) {
      console.error("读取 EC2 状态失败:", error)
    }
    return { ...traffic, instance }
  }
}

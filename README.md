# AWS EC2 流量监控小组件

这是一个独立的 iOS Scripting 任务，与阿里云 CDT 监控脚本分开。导入 `AWSEC2.scripting` 后，在 Scripting App 内完成配置即可使用主屏幕和锁屏小组件。

## 监控口径

脚本读取 CloudWatch `AWS/EC2` 的 `NetworkOut`，以 `Sum`、`Bytes`、300 秒周期累计当前 UTC 自然月，默认阈值为 `100 GB`。1 GB 按十进制 `1,000,000,000` bytes 计算，阈值可在设置中修改。

这能监控“这台 EC2 的 CloudWatch 网络出口是否接近 100 GB”，但不等于 AWS 账单的精确出站流量或账户免费额度余额。跨区域传输、NAT Gateway、CloudFront、IPv4 和其他 AWS 服务可能产生不由该实例 `NetworkOut` 完整表达的计费项。AWS 官网当前说明的 100 GB Internet data transfer out 免费额度是跨 AWS 服务和区域聚合的账号级规则（中国区和 GovCloud 除外），不能简单按单台 EC2 余额判断。

## 配置

1. AWS Access Key ID。
2. AWS Secret Access Key。
3. 临时凭据的 Session Token；长期密钥可留空。
4. EC2 所在 Region，例如 `us-east-1`、`ap-southeast-1` 或 `cn-north-1`。
5. EC2 实例 ID。
6. 月度 NetworkOut 阈值，默认 `100 GB`。

凭据保存在 Scripting 本机 Storage，代码包不包含真实凭据。建议使用专用、只读、定期轮换的 IAM 凭据；Scripting Storage 不是专用密钥保管库。

## 最小 IAM 权限

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ReadEc2MonthlyNetworkOut",
      "Effect": "Allow",
      "Action": [
        "cloudwatch:GetMetricData",
        "ec2:DescribeInstances"
      ],
      "Resource": "*"
    }
  ]
}
```

脚本只读取 CloudWatch 和 EC2，不会启动、停止、重启或修改实例，也不查询账单金额。

## 官方依据

- [EC2 CloudWatch instance metrics](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/viewing_metrics_with_cloudwatch.html)
- [Amazon EC2 On-Demand pricing](https://aws.amazon.com/ec2/pricing/on-demand/)

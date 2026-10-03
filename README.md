# AWS EC2 流量监控与状态看板 (Scripting iOS)

[![Platform](https://img.shields.io/badge/platform-iOS%2016%2B-lightgrey.svg)](https://apps.apple.com/app/scripting/id1575361494)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

专为 iOS **Scripting** 打造的 AWS EC2 免费月度出站流量 (NetworkOut) 监控与实例状态看板，采用 TypeScript + TSX 构建，支持 iOS 16+ 桌面全尺寸小组件。

---

## 🚀 一键安装 (快速导入)

在已安装 **Scripting** 的 iPhone / iPad 上，点击下方链接即可自动唤起 Scripting 确认安装：

👉 **[📥 点击一键导入到 Scripting (GitHub 原链)](https://scripting.fun/import_scripts?urls=%5B%22https%3A%2F%2Fraw.githubusercontent.com%2FZTTYBB%2FAWSEC2Monitor%2Fmain%2FAWSEC2.scripting%22%5D)**

👉 **[⚡ 点击一键导入到 Scripting (国内 CDN 加速)](https://scripting.fun/import_scripts?urls=%5B%22https%3A%2F%2Ffastly.jsdelivr.net%2Fgh%2FZTTYBB%2FAWSEC2Monitor%40main%2FAWSEC2.scripting%22%5D)**

> 当前发布包为 `1.1.2`。`AWSEC2.scripting` 包内使用 Scripting 约定的 `index.tsx` 与 `widget.tsx` 入口文件；不要在安装包内改成 `aws_index.tsx` 或 `aws_widget.tsx`。

---

## 📊 监控口径

脚本读取 CloudWatch `AWS/EC2` 的 `NetworkOut`，以 `Sum`、`Bytes`、300 秒周期累计当前 UTC 自然月，默认阈值为 `100 GB`。1 GB 按二进制 `1,073,741,824` bytes (GiB) 计算，与 AWS 官方账单和扣费口径严格对齐，阈值可在设置中修改。

这能监控“这台 EC2 的 CloudWatch 网络出口是否接近 100 GB”。AWS 官网说明的 100 GB Internet data transfer out 免费额度是跨 AWS 服务和区域聚合的账号级规则（中国区和 GovCloud 除外）。

主页和桌面小组件的“日均可用” = 剩余流量 ÷ 当前 UTC 月份剩余天数（含当天），保留两位小数，沿用剩余流量的统计单位。比如 10 月 3 日剩余 90.71 GB，还有 29 天，日均可用约 3.13 GB。超过本地阈值时显示 0；没有有效数据或缓存属于上个月时显示待更新。这是单实例、本地阈值下的分配参考，不代表 AWS 账号的实际免费额度，缓存和 CloudWatch 延迟也会影响估算。

---

## ⚙️ 手机端配置

每次打开脚本都会先进入主页。进入设置后，填写以下配置：
1. **AWS Access Key ID**
2. **AWS Secret Access Key**
3. **Session Token**（临时凭据填写；长期密钥留空）
4. **Region**：例如 `ap-southeast-1`（新加坡）或 `us-east-1`
5. **Instance ID**：EC2 实例 ID（例如 `i-0363cc4c1957d01ea`）
6. **月度 NetworkOut 阈值**：默认 `100 GB`（或按需设为 `95 GB`）

Access Key、Secret 和 Region 保存后即可返回主页，Instance ID 可以稍后补充。凭据保存在 Scripting 本机 Storage，绝不上云。脚本启动时会同步读取已保存配置；只有凭据、Region 和 Instance ID 都存在时才查询 CloudWatch。保存时按 Scripting 原生同步方式写入后立即返回主页。旧版本的 `aws_ec2_monitor_config` 配置也会自动兼容读取。

---

## 🔒 最小 IAM 权限

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

脚本仅查询 CloudWatch 和 EC2 状态，不会修改任何 AWS 资源。

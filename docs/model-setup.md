# 模型配置

顶部第二行选择「本地模型 / 模型套餐 / API / 混合」，点击摘要旁箭头展开配置。模型列表读取和短生成测试是两个独立操作：完成一次生成测试后才会显示通过。

## 本地模型

| 服务 | 默认地址 | 协议 |
| --- | --- | --- |
| Ollama | `http://127.0.0.1:11434` | 原生聊天与模型目录 |
| LM Studio | `http://127.0.0.1:1234/v1` | OpenAI Chat Completions |
| 其他兼容服务 | 按服务实际地址填写 | OpenAI Chat Completions |

先在对应工具中下载或加载模型，并启动服务。读取列表后选择模型，也可以手动填写准确的模型 ID。切换本地服务会保留各自的地址与模型配置；本工具不自动安装模型或启动其他模型工具。

本地服务要求认证时，填写独立访问令牌。令牌只保留在当前会话，与云 API、套餐密钥分别管理。

## 模型套餐

| 接入方式 | 配置 |
| --- | --- |
| ChatGPT 套餐（Codex） | 使用本机已安装并登录的 Codex 客户端；读取模型或填写准确 ID，留空使用当前默认模型 |
| MiniMax 套餐 | 使用 M Plan / Token Plan 订阅 Key、官方接口地址与模型 ID；支持 OpenAI 或 Anthropic 协议 |
| 其他授权套餐 / 接口 | 选择服务商预设或自定义，填写厂商允许本工具调用的接口及密钥 |

服务商预设包括 Claude、Gemini、Grok、DeepSeek、Qwen、Kimi、GLM 等。预设提供协议和地址，不证明某个网页会员或编程工具套餐可以由本工具使用。需要独立 API Key 的服务按厂商接口规则计费；MiniMax 按量 Key 也采用独立计费规则。

兼容接口支持 OpenAI Chat Completions、Anthropic Messages 和 Gemini GenerateContent。没有账号模型目录的接口需要手动填写完整模型 ID。

### 配置导入

「配置示例」可下载 JSON 格式。示例中的域名仅为占位符：

```json
{
  "connection": "compatible",
  "vendor": "other",
  "protocol": "openai",
  "endpoint": "https://your-provider.example/v1",
  "model": "your-exact-model-id"
}
```

地址字段也支持 `base_url`、`baseUrl`；可选密钥字段为 `apiKey` 或 `api_key`。配置文件如果含密钥，应由用户自行妥善保存，不要提交到仓库。载入后核对地址、模型和计费方式，再保存。

导入不接受账号 Cookie、OAuth 会话或密码。本工具沿用已有 Codex 登录，不读取凭据文件或改写 Codex 全局设置。切换套餐接入方式、服务商或修改地址，会清空当前编辑的套餐密钥。

## API 与混合模式

API 模式填写兼容接口、模型名称及 API Key。公网接口使用 HTTPS；本地和内网服务按其地址配置。

混合模式勾选所需通道，为资料分析、文件生成和图像识别分别指定通道。失败时显示错误，不会自动改用其他通道。扫描件 OCR 需要所选模型支持图像输入。

所有接口密钥仅保留在主进程当前会话中，退出后清空。项目目录与非密钥配置会在重启后恢复。

## 接入参考

以下链接是实现和接入说明的参考，厂商规则、模型与额度以当前账号及最新官方文档为准。

- [Codex App Server](https://developers.openai.com/codex/app-server/)
- [MiniMax 自定义工具接入](https://platform.minimax.cn/docs/m-plan/other-tools)
- [Ollama Chat](https://docs.ollama.com/api/chat) · [模型目录](https://docs.ollama.com/api/tags)
- [LM Studio 兼容接口](https://lmstudio.ai/docs/developer/openai-compat)
- [Claude 认证使用边界](https://code.claude.com/docs/en/legal-and-compliance)
- [Gemini CLI 条款说明](https://geminicli.com/docs/resources/tos-privacy/)
- [DeepSeek API](https://api-docs.deepseek.com/) · [Grok API](https://docs.x.ai/developers/rest-api-reference/inference)

# 开发与构建

界面使用 Astro、React 和 TypeScript，桌面壳使用 Electron。发行版以本地自定义协议加载已构建界面，不依赖开发服务。

## 目录

| 目录 | 内容 |
| --- | --- |
| `src/` | 界面、业务逻辑与相邻单元测试 |
| `desktop/` | 原生窗口、目录访问、模型与 Skills 服务 |
| `tests/desktop/` | 当前桌面验收与候选安装检查 |
| `tests/fixtures/` | 虚构测试数据 |
| `skills/` | 本项目工作流指引和模板 |
| `scripts/` | 构建、更新与维护入口 |
| `docs/` | 用户和开发文档 |
| `release/` | 本机当前稳定运行版及对应 ZIP，忽略于 Git |
| `.cache/validation/` | 测试 profile、报告与截图，忽略于 Git |

历史本机验收材料位于被忽略的 `docs/validation/local/`。本机依赖路径配置使用被忽略的 `config/local-build.json`；仓库不包含用户资料、密钥或导入的第三方 Skills。

## 依赖与检查

在项目根目录运行命令。需要 Node.js 24 或更新版本、npm，以及 Windows 桌面运行环境；依赖版本由 `package-lock.json` 固定。

```powershell
npm ci
npm run check
npm test
npm run test:desktop
npm run build
```

`test:desktop` 检查原生服务；界面测试通过 Playwright 驱动独立 Electron 进程。它们使用虚构数据与独立 profile，输出统一写入 `.cache/validation/`。

## 构建路径

构建工具按「环境变量 → 本机 `config/local-build.json` → 项目依赖」查找 Electron 和 PE 构建库。Electron、`pe-library`、`resedit` 为构建依赖，打包后的应用不要求用户另外安装这些依赖。

需要本机覆盖配置时，可将 `config/local-build.example.json` 复制为 `config/local-build.json`。不覆盖路径时保持 `{}`；需要复用已有依赖时，可填写 `electronDist`、`buildModules` 中的一项或两项，值必须是有效的非空目录路径。不要用空字符串占位；未填写的项继续按上述顺序解析。

| 环境变量 | 用途 |
| --- | --- |
| `PRESALES_SOLUTION_TOOL_ELECTRON_DIST` | 完整 Electron 运行时目录 |
| `PRESALES_SOLUTION_TOOL_BUILD_MODULES` | 包含 PE 构建依赖的模块目录 |
| `PRESALES_SOLUTION_TOOL_EXECUTABLE` | 桌面验收使用的候选 EXE |
| `PRESALES_SOLUTION_TOOL_TEST_DATA` | 独立测试数据目录 |
| `PRESALES_SOLUTION_CODEX` | 明确指定 Codex 客户端命令 |

上一版 `SOLUTION_TOOL_*`、`SOLUTION_CODEX` 及更早 `BID_*` 变量仍兼容；新变量优先。不要将个人机器上的绝对路径写入共享脚本。

## 当前桌面验收

```powershell
node tests/desktop/smoke-installed.cjs
node tests/desktop/check-workbench-layout.cjs
node tests/desktop/check-file-cleanup.cjs
node tests/desktop/check-plans-skills.cjs
```

前三个专项不调用真实模型；套餐和 Skills 专项用本地模型服务及受控网络响应验证请求链路。`smoke-model-controls.cjs`、`smoke-local-models.cjs` 和 `smoke-responsive.cjs` 也位于该目录，分别覆盖模型设置、本地协议与复杂响应式页面。

`smoke-installed.cjs` 可通过 `PRESALES_SOLUTION_TOOL_EXECUTABLE` 指定候选 EXE。它读取候选包版本、使用独立 profile，并在退出时关闭自身测试进程；不会关闭正在使用的生产工具。

检查成功并关闭测试实例后，清除本次隔离 profile，保留报告与验收截图；失败时保留 profile 和已有诊断文件，便于排查。

## 打包与更新

```powershell
npm run package:desktop
./scripts/build-launcher.ps1
node scripts/update-desktop.cjs
```

更新入口的候选验证、替换和失败恢复流程见 [发行说明](releases.md)。已安装稳定版只在候选验证成功后替换；成功后删除临时恢复副本和旧发行包。

原生层维护用户数据目录、存储键与本地页面 origin 的兼容标识，避免升级后丢失模型配置、项目缓存及目录授权。代码来源基线为 CAVWIC Solutions Lab 的 `19d6b39453138d1f8930714fec58295342ad805a`，后续桌面改动见 [CHANGELOG](../CHANGELOG.md)。

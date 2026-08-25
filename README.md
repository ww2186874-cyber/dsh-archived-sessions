# DSH Archived Sessions

一个面向 DeepSeek Harness Web 的独立 Cordis Profile Bundle，用于查看并恢复已归档会话。

## 功能

- 在 DSH 现有设置面板中增加“已归档会话”页面及管理入口；
- 使用插件自有的全屏管理页面展示全部已归档会话；
- 显示会话标题、工作区、创建时间、Agent Preset 和路径；
- 支持刷新、恢复、空状态、加载状态、错误状态和安全降级；
- 恢复只改变归档集合，不复制、不改写、不删除会话日志，也保留原工作区位置。

## 为什么没有伪造 URL 路由

当前 DSH `0.1.1-rc.2` 没有公开第三方页面路由注册接口。插件因此使用官方的：

- `settings.section`
- `shell.overlay`

组合出独立全屏页面。这样不会修改 Web Shell、替换顶层页面、依赖内部 DOM 或劫持浏览器 history，升级兼容性显著优于硬编码路由。

## 恢复兼容策略

当前 DSH 公开了 `archiveSession()` 和持久化的 `archivedSessionIds`，但尚未公开 `unarchiveSession()`。插件的 Host 适配器按以下顺序工作：

1. 若运行时提供官方 `workspaceRegistry.unarchiveSession()`，自动优先使用，并在调用后核对权威归档集合；
2. 否则必须同时匹配 DSH `0.1.1-rc.2` 的归档状态结构、唯一 ID 约束以及四个关键方法的精确 SHA-256 实现指纹，才会启用 rc.2 兼容适配器；
3. 若任何结构或指纹不匹配，恢复按钮会被安全禁用并显示原因，不会猜测或写入未知数据。

兼容适配器与 DSH 自身的归档操作共用串行队列，只移除目标 `archivedSessionIds`，并原样保留工作区顺序、会话归属位置和其他状态字段。任何未来 DSH 版本都不会仅凭“字段恰好同名”进入私有兼容路径。详见 [COMPATIBILITY.md](COMPATIBILITY.md)。

## 安装到 Web Profile

### 源码工作区安装（本仓库采用）

源码仓库建议位于：

```text
%DSH_HOME%\profiles\web\packages\dsh-archived-sessions
```

Web Profile 的 `package.json` 需要包含：

```json
{
  "dependencies": {
    "dsh-archived-sessions": "workspace:*"
  },
  "dsh": {
    "profile": {
      "bundles": [
        "dsh-archived-sessions"
      ]
    }
  }
}
```

然后在 Profile 根目录运行：

```powershell
pnpm install
```

也可以从插件源码仓库目录让 DSH CLI 完成安装与 Bundle 对账：

```powershell
dsh plugin --profile web add .
```

### GitHub 安装

已获私有仓库访问权限且本机 Git 凭据可用时：

```powershell
dsh plugin --profile web add github:ww2186874-cyber/dsh-archived-sessions#main
```

更新或卸载：

```powershell
dsh plugin --profile web update dsh-archived-sessions
dsh plugin --profile web remove dsh-archived-sessions
```

首次安装新增 Host Bundle，需要由用户自行重启 DSH Web Profile。刷新已有页面不足以加载新的 Host row；本项目也不会擅自重启 DSH。

## 卸载

1. 从 Web Profile `package.json` 的 `dependencies` 和 `dsh.profile.bundles` 中移除 `dsh-archived-sessions`；
2. 在 Profile 根目录运行 `pnpm install`；
3. 由用户自行重启 DSH Web Profile；
4. 如果不再需要源码，再单独删除源码仓库目录。

卸载插件不会修改任何会话日志，也不会清空 DSH 已有的归档集合。

## 开发

```powershell
pnpm install --frozen-lockfile
pnpm bundle
pnpm verify
pnpm verify:runtime -- "C:\\path\\to\\current-dsh-runtime"
pnpm pack --dry-run
```

- Client 真源：`src/client-module.js`
- Client 生成产物：`lib/client.js`
- Host：`lib/index.js`
- Bundle patch：`cordis.patch.yml`

修改 Client 后必须执行 `pnpm bundle`，并提交生成产物。

`ci/github-actions.yml` 提供 Node 22.19 / 24 的 GitHub Actions 模板。将仓库凭据授予 `workflow` scope 后，可复制到 `.github/workflows/ci.yml` 启用；模板路径本身不会被 GitHub 自动执行。

## 升级检查

每次升级 DSH 后，先找到新的实际 Runtime checkout，再执行：

```powershell
pnpm verify
pnpm verify:runtime -- "C:\\path\\to\\new-dsh-runtime"
pnpm pack --dry-run
```

`verify:runtime` 会核对声明的 DSH 版本、rc.2 适配器方法指纹，以及当前 Settings、Overlay、Session Query、Web Server 类型契约。它失败时不得绕过或手工放宽指纹；应先审查新版本并发布插件更新。即使自动检查通过，GUI 验证仍是必需步骤。

随后在 GUI 中确认：

1. 设置页入口仍可见，且侧栏底部不出现插件入口；
2. 管理页能列出归档会话；
3. 页面顶部的兼容能力提示符合预期；
4. 恢复一个测试会话后，它重新出现在原工作区位置；
5. 页面刷新和 DSH 重启后恢复结果仍然存在。

## 安全边界

- HTTP API 仅接受直接 loopback 请求；
- 拒绝转发头与跨站请求；
- 恢复 POST 必须带有与 Host 精确相同的 `Origin` 和浏览器 `Sec-Fetch-Site: same-origin`；
- POST 只接受有大小限制的 JSON；
- 不向浏览器暴露 Session、Service、Domain 等 Host 活对象，只返回必要的标量字段；
- 不修改 DSH Runtime checkout，不操作 DSH Web Shell 文件。

## License

MIT

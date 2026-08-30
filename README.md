# DSH Archived Sessions

一个面向 DeepSeek Harness Web 的独立 Cordis Profile Bundle，用于在现有设置页中查看并恢复已归档会话。

## 兼容性

- DSH：当前包的 `engines.dsh` **仅声明支持 `0.1.1-rc.2`**；
- Node.js：`>=22.19.0`；
- 包管理器：仓库使用 pnpm，锁定的开发版本见 `package.json` 的 `packageManager` 字段。

不要为了在其他 DSH 版本上安装而忽略 `engines.dsh`。升级 DSH 后必须先执行本文的[升级检查](#升级检查)；只有审查新实现并发布相应插件版本后，才能扩大兼容范围。

## 功能

- 通过公开的 `settings.section` Slot 在 DSH 设置面板中提供“已归档会话”页面；
- 为归档集合中的每个会话 ID 建立一条记录，并按创建时间倒序显示可读取的会话信息；
- 在摘要可用时显示标题、所属工作区、创建时间、Agent Preset 和工作路径；
- 会话日志暂时不可读取时仍保留该条目，并明确标记日志不可用；
- 支持刷新、恢复、空状态、加载状态、错误状态和兼容性安全降级；
- rc.2 兼容路径只改变归档集合；native 路径调用宿主提供的 `unarchiveSession()`，并验证目标 ID 已移出归档集合；插件自身不复制、改写或删除会话日志，也不提供永久删除功能。

## 界面与数据集成

插件只使用公开的 `settings.section` Slot 提供设置页，不增加侧栏入口，不替换 Web Shell 顶层区域，不查询 DSH 内部 DOM，也不劫持浏览器 history。

Host 端通过 `workspaceRegistry` 读取归档集合和工作区归属，通过 `sessionQuery.readTitleSnapshots()` 读取归档会话的必要摘要。浏览器只接收插件重新构造的标量字段，不会取得 Session、Service、Domain 或其他 Host 活对象。

## 恢复兼容策略

受支持的 DSH `0.1.1-rc.2` 的 `WorkspaceRegistry` 实现包含 `archiveSession()`，并持久化 `archivedSessionIds`，但没有 `unarchiveSession()`。其中恢复 fallback 依赖下述私有实现指纹，不应把这些实现细节当作稳定公开 API。插件按以下顺序选择恢复路径：

1. 若运行时对象提供可调用的 `workspaceRegistry.unarchiveSession()`，代码会优先使用该宿主方法，并在调用后重新核对权威归档集合；这不等于自动声明该 DSH 版本受支持，扩大版本范围仍需单独审查和发布；
2. 否则，只有归档 ID 唯一、状态结构符合预期，且 `archiveSession`、`setState`、`enqueueOperation`、`recoverPendingMutation` 四个方法的 SHA-256 实现指纹全部精确匹配已审计的 rc.2 版本时，才启用兼容适配器；
3. 任一结构、唯一性或指纹检查失败时，恢复功能会安全禁用并显示原因，不会猜测或写入未知状态。

兼容适配器与 DSH 自身的工作区写操作共用串行队列；进入队列后会再次检查指纹和状态一致性。写入时只从 `archivedSessionIds` 移除一个目标 ID，并保留其他所有状态字段。恢复后还会再次确认目标 ID 已不在权威归档集合中。原工作区位置由 DSH rc.2 保留的会话归属关系决定。详见 [COMPATIBILITY.md](COMPATIBILITY.md)。

## 安装到 Web Profile

安装会修改 Web Profile 的依赖和 Bundle 列表。插件源码应保留为独立 Git 仓库；不要把源码复制进 DSH Runtime checkout。

### 从本地源码安装（推荐用于开发）

Windows 上可将非官方插件源码放在独立目录，例如：

```text
C:\dsh-plugins\dsh-archived-sessions
```

克隆后，在插件源码目录执行：

```powershell
git clone https://github.com/ww2186874-cyber/dsh-archived-sessions.git C:\dsh-plugins\dsh-archived-sessions
Set-Location C:\dsh-plugins\dsh-archived-sessions
dsh plugin --profile web add .
```

`dsh plugin` 会把参数转交给 Profile 目录中的 pnpm，并在安装后根据包的 `dsh.bundle` 声明对账 `dsh.profile.bundles`。运行该命令前，`dsh` 和 `pnpm` 都需要位于 `PATH`。

如需手工配置，请把以下字段**合并**进 `%DSH_HOME%\profiles\web\package.json`，不要覆盖 Profile 中已有的依赖或 Bundle：

```json
{
  "dependencies": {
    "dsh-archived-sessions": "link:C:/dsh-plugins/dsh-archived-sessions"
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

然后执行：

```powershell
Set-Location "$env:DSH_HOME\profiles\web"
pnpm install
```

### 从 GitHub 安装

本机 Git 必须能够访问目标仓库；公开仓库通常不需要凭据，私有仓库需要相应权限。为了可复现安装，正式环境建议把 `<ref>` 换成已审查的 tag 或完整 commit；跟踪开发分支时可使用 `main`。

```powershell
dsh plugin --profile web add "github:ww2186874-cyber/dsh-archived-sessions#<ref>"
```

### 更新

GitHub 依赖可通过 Profile 插件命令更新：

```powershell
dsh plugin --profile web update dsh-archived-sessions
```

本地 `link:` 安装不会通过上述命令拉取源码；应在独立源码仓库中自行获取更新，并在信任新提交后执行验证：

```powershell
Set-Location C:\dsh-plugins\dsh-archived-sessions
git pull --ff-only
pnpm install --frozen-lockfile
pnpm verify
pnpm pack --dry-run
```

### 使安装变更生效

新增、更新或移除这个 Host Bundle 后，需要由用户自行重启 DSH Web Profile。只刷新浏览器页面不足以装载新的 Host 代码；本项目不会代替用户停止或重启 DSH。

## 使用

1. 打开 DSH Web 的设置；
2. 选择“已归档会话”；
3. 查看或刷新列表；
4. 点击目标会话右侧的“恢复”；
5. 根据成功提示在侧栏人工确认会话是否回到预期工作区。

如果归档数组有效、但当前运行时不符合安全恢复条件，列表仍可显示，恢复按钮会禁用并给出原因。归档集合缺失或包含重复 ID 时，Host 会拒绝整个列表请求并显示错误。

## 卸载

推荐使用：

```powershell
dsh plugin --profile web remove dsh-archived-sessions
```

如果手工卸载，则从 Web Profile `package.json` 的 `dependencies` 和 `dsh.profile.bundles` 中移除 `dsh-archived-sessions`，再在 Profile 根目录运行 `pnpm install`。之后由用户自行重启 DSH Web Profile。

卸载只移除插件依赖和 Bundle 配置：不会删除独立源码仓库，不会修改会话日志，也不会清空 DSH 已有的归档集合。

## 开发与验证

```powershell
pnpm install --frozen-lockfile
pnpm bundle
pnpm verify
pnpm verify:runtime -- "C:\path\to\current-dsh-runtime-root"
pnpm pack --dry-run
```

- Host 源码：`lib/index.js`；
- Client 真源：`src/client-module.js`；
- Client 生成产物：`lib/client.js`；
- Bundle patch：`cordis.patch.yml`；
- `pnpm verify`：检查生成产物、JavaScript 语法并运行 Host/Client 测试；
- `pnpm pack --dry-run`：触发 `prepack` 验证并检查实际发布文件。

修改 Client 后必须执行 `pnpm bundle` 并提交更新后的 `lib/client.js`。

`verify:runtime` 的参数必须是 Runtime 根目录：其中应有根 `package.json`，并在 `node_modules/.pnpm` 下安装 DSH 包；不要传内部的 `dsh-web-app` 包目录。该命令会读取目标 Runtime 的包清单和类型声明，并导入其中的 `@deepseek-ai/dsh-workspace/lib/index.js` 来核对方法指纹，因此只能传入受信任的实际 Runtime。省略参数时，脚本只会在 `%LOCALAPPDATA%\dsh-runtime` 下恰好找到一个候选 Runtime 根目录的情况下自动选择，否则会要求显式指定。

`ci/github-actions.yml` 是 Node 22.19 / 24 的 GitHub Actions 模板。它不位于 `.github/workflows`，因此不会自动运行；如需启用，请先审查后复制到 `.github/workflows/ci.yml`。模板当前使用 `actions/*@v4` 大版本标签；用于受保护的发布流程前，建议改为已审查的完整 commit SHA。

## 升级检查

每次升级 DSH 后，先找到新的实际 Runtime checkout，再执行：

```powershell
pnpm verify
pnpm verify:runtime -- "C:\path\to\new-dsh-runtime-root"
pnpm pack --dry-run
```

`verify:runtime` 会核对声明的 DSH 版本、rc.2 适配器方法指纹，以及 Settings、Session Query、Client Runtime、Web Server 的类型契约。检查失败时不得绕过或放宽指纹；应先审查新版本实现并发布插件更新。即使自动检查通过，也必须完成 GUI 验证：

1. 设置页入口可见，且侧栏没有新增插件入口；
2. “已归档会话”页直接显示列表，刷新可用；
3. 恢复能力不可用时，页面显示安全禁用原因；
4. 恢复一个测试会话后，在侧栏人工确认它重新出现在原工作区位置；
5. 刷新页面并由用户重启 DSH 后，恢复结果仍然存在。

## 安全边界

当前仓库的运行时代码具有以下边界：

- 没有第三方 `dependencies` 或 `devDependencies`，锁文件也没有解析外部包；Client 通过 DSH 客户端模块加载器取得共享的 React，而 `dsh.client.inject` 声明注入 Client Runtime 与 Settings 服务；
- 没有 `preinstall`、`install`、`postinstall` 或 `prepare` 生命周期脚本；
- 不执行 shell 命令，不读取凭据，不使用遥测，也不向外部主机发起运行时网络请求；Client 只请求同源的两个插件 API；
- HTTP API 只接受 `socket.remoteAddress` 为 loopback、`Host` 请求头中的 authority 也是 loopback，且不带转发头的直接请求；
- 带有 `Sec-Fetch-Site: cross-site` 或不匹配 `Origin` 的请求会被拒绝；恢复 POST 还必须带有与当前 Host 精确匹配的 `Origin` 和 `Sec-Fetch-Site: same-origin`；
- 恢复 POST 只接受 JSON，请求体上限为 8192 字节；响应禁止缓存并带有 `nosniff`；
- 意外的 Host 内部错误会在返回浏览器前隐藏具体异常内容，但完整错误字符串可能写入本机 DSH 日志，应按敏感本地数据管理日志；
- rc.2 私有兼容写入采用精确指纹、队列内复检、状态冲突检查和写后归档成员关系验证；
- 宿主提供的 `unarchiveSession()` 属于受信任宿主边界；插件会验证目标 ID 已移出归档集合，但不会审计该方法造成的其他宿主状态变化；
- 请求体有 8192 字节上限，但插件不单独设置读取超时，连接超时依赖 Host Web Server；
- 不修改 DSH Runtime checkout，不操作 Web Shell 文件，不删除会话日志。

Loopback 和同源检查用于阻止远程访问和普通浏览器跨站请求，不是应用层身份认证：本机进程可以自行构造这些 HTTP 标头，同一 DSH Origin 内的其他代码也能发起同源请求。因此，本机其他进程可能读取归档元数据或调用恢复接口。不要通过不受信任的反向代理暴露此 API，也不要在不可信的共享主机环境中把它视为用户隔离机制。

## License

MIT

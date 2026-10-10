# 白泽 Manager × Wechatsync 下载安装与联调

本分支是 edyang/Wechatsync 官方 v2 Fork 的白泽适配开发版，针对 [白泽 Manager MCP 开发 PR #21](https://github.com/edyang/baize-website-manager/pull/21)。未合并主分支、未调用真实平台账号对外发布。

## 1. 获取安装包

打开本仓库 **Actions → Baize Wechatsync installers → 最新成功运行 → Artifacts**。下载两个文件：

- `Wechatsync-Baize-Chrome-v2`：Chrome 扩展 ZIP。下载 GitHub Actions 的外层压缩包后，再解开内层 ZIP，使 `manifest.json` 位于解压目录顶层。
- `Wechatsync-Baize-MCP-Server`：带运行依赖的 Node.js MCP 服务 ZIP，同样解开内层 ZIP 后，目录中应有 `mcp-server/dist/index.js` 和 `mcp-server/node_modules`。

ZIP 是 Chrome **开发者模式解压加载版**，不是 Chrome Web Store 签名的 CRX。不要把 ZIP 直接拖到浏览器安装。

## 2. Chrome 扩展安装

1. 打开 Chrome 的 `chrome://extensions/`，启用「开发者模式」。
2. 建议先禁用旧版本 Wechatsync，避免两个扩展同时连接相同 MCP WebSocket。
3. 点击「加载已解压的扩展程序」，选择含 `manifest.json` 的目录。
4. 在知乎、掘金、CSDN 登录账号，打开扩展设置，启用 MCP 桥接。
5. 填写 WebSocket 地址 `ws://127.0.0.1:9527`（若服务器另在局域网，请填写内网 IP），桥接 Token 必须与服务的 `WECHATSYNC_TOKEN` 一致。

## 3. 启动 MCP Server（Node.js 22）

在服务器上解压 MCP 安装包，进入含 `dist/index.js` 的 `mcp-server` 目录。

Linux/macOS 示例（请自行生成两个**不同**的强随机令牌，切勿写入仓库）：

```bash
export WECHATSYNC_TOKEN='浏览器桥接令牌'
export WECHATSYNC_HTTP_TOKEN='Manager访问MCP专用Bearer令牌'
export SYNC_WS_PORT=9527
export SYNC_HTTP_PORT=9528
export SYNC_BRIDGE_API_PORT=9529
# Manager 如果位于另一容器/局域网主机，需经私网防火墙/HTTPS代理再设：
# export SYNC_HTTP_HOST=0.0.0.0
node dist/index.js --sse
```

- SSE 地址默认 `http://127.0.0.1:9528/sse`；用于 Manager。
- 扩展连接 `ws://127.0.0.1:9527`；与 SSE 地址是两个独立端口。
- 桥接内部 API 使用 `127.0.0.1:9529`，且带 Token 验证，不是外部访问入口。
- SSE GET 和 POST 都强制 Bearer Token；缺少 `WECHATSYNC_HTTP_TOKEN` 会返回 503。Manager 测试连接时须先保存 Token。
- 若 Manager 部署在 Docker 中，`localhost` 指 Manager 容器，不是 MCP 宿主机；请使用容器可访问的内网地址或反向代理。
- 请使用 VPN/内网、防火墙限制 SSE 和 WS 端口；`SYNC_HTTP_HOST` 默认仅监听本机回环地址。

## 4. Manager 配置与发布模式

打开 `https://chsparta.com/admin/content-settings`（需要 Manager PR #21 已部署），在「Wechatsync MCP」配置：

- MCP SSE 地址：例 `http://内网地址:9528/sse`
- Bearer Token：`WECHATSYNC_HTTP_TOKEN` 的值，**不是**浏览器桥接令牌。
- 保存后点击「测试连接」，此时只读取平台登录状态，不生成文章。
- 建议先为知乎、CSDN、掘金使用**保存草稿**模式进行验收。核对图片、标签、封面、公开链接状态后再开启「正式发布」。
- 其他平台目前保持草稿模式；B站专栏、微信公众号、小红书等并未因此获得经验证的直接发布接口。

发布门槛：`publish=true` 且 `confirmPublish=PUBLISH`，并且仅目标 `zhihu`、`csdn`、`juejin`；否则在创建远程稿件前拒绝。Manager 提供的 `idempotencyKey` 在扩展本地持久化：重复调用会复用已完成结果，未完成记录锁定以避免重复发稿。

## 5. 封面策略

MCP 输入 `cover` 优先；未提供时，从 Markdown 第一张有效图片提取，必要时回退到正文 HTML 第一张有效 `<img>`。跳过代码围栏内的示例和非 HTTP(S)/受支持 data:image 图片。CSDN、掘金上传封面至平台自身图床后写入封面字段。知乎使用正文图片，是否自动选择为文章封面须以目标平台结果为准。

## 6. 验收限制

CI 只证明编译和本地测试通过，**不能替代真实账号验收**。未经平台帐号所有者授权不要启用直接发布。浏览器登录态复用与非官方接口可能受平台页面更改、审核及风控限制。

发布结果可能是：`draft`、`submitted`、`reviewing`、`published`、`unknown`。只有返回 `status=published` 且 `verification.verified=true` 的公开文章才应在 Manager 中标为已发布。请求超时或失败，不应盲目重试。


## 7. Linux systemd 一键安装（推荐）

新版 GitHub Actions 产物增加 **Wechatsync-Baize-MCP-Linux** 安装包，包含 systemd 服务安装/升级、服务管理、日志、卸载脚本以及环境变量示例。需要单独安装白泽版 Chrome 扩展。Linux 需有 systemd 和系统级 Node.js 22+，包内已带生产依赖，无需在目标主机安装 npm 包。

下载 Actions artifact 并依次解压外层与内层 ZIP，进入包含 install.sh 的目录：

~~~bash
sudo bash install.sh
sudo /opt/wechatsync-mcp/bin/status.sh
sudo /opt/wechatsync-mcp/bin/logs.sh --follow
sudo /opt/wechatsync-mcp/bin/manage.sh restart
sudoedit /etc/wechatsync-mcp/.env
sudo systemctl restart wechatsync-mcp
~~~

安装过程自动生成 **两组不同的随机密钥**，分别供 Chrome WebSocket 和 Manager MCP SSE Bearer 使用，绝不将 Token 输出到安装日志。真正运行的配置是 /etc/wechatsync-mcp/.env（root 拥有，0600）；再次执行安装脚本会保留旧配置。systemd 服务使用独立的低权限运行账户，开机自启，日志可用 journalctl 查看。

默认安全策略：WebSocket 9527、MCP SSE 9528 均仅监听 127.0.0.1，内部桥接 9529 永远只允许本地。若 Chrome 在另一台电脑，通过 SSH 端口转发连接本地 9527；如果 Manager 部署在不同容器或主机，应通过私网、VPN 或受控 HTTPS 反向代理连接 SSE，禁止直接将端口裸露公网。

卸载保留配置：

~~~bash
sudo /opt/wechatsync-mcp/bin/uninstall.sh
~~~

彻底删除密钥及配置：从仍保留的解压目录执行 sudo bash uninstall.sh --purge。更多步骤与注意事项参见 [Linux 部署包完整说明](../deploy/linux/README.md)。

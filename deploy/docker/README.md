# 白泽 Wechatsync MCP · Docker 离线安装包

此包包含已构建的 Docker 镜像 image.tar.gz、Docker Compose、.env 示例、安装/管理/卸载脚本，以及无发稿动作的网络联通测试。适用 Linux Docker Engine 和 Docker Desktop，要求 Docker Compose v2。**不需要在容器中安装 Chrome**；宿主机 Chrome 扩展通过 WebSocket 主动连接容器。

## 一、下载安装

从 edyang/Wechatsync 的 GitHub Actions 成功构建结果中下载 Wechatsync-Baize-MCP-Docker Artifact。依次解压 GitHub 外层压缩包以及 Wechatsync-Baize-MCP-Docker.zip，进入包含 compose.yaml 和 image.tar.gz 的目录。

执行：

    bash install.sh

首次自动生成 .env 中两组互不相同的 256-bit 随机密钥，文件权限 0600；安装时将现成 Docker 镜像载入本机（无需下载 Node.js 依赖，也无需从 Registry 拉镜像），创建共享 Docker 网络并启动容器。再次执行是安全升级，自动保留原有 .env。

## 二、连接本机 Chrome

1. Chrome 安装白泽版 Wechatsync 扩展，在知乎/CSDN/掘金等平台登录。
2. 在扩展的 MCP 设置中启用连接：
   - WebSocket: ws://127.0.0.1:9527
   - Token: 读取本目录 .env 的 WECHATSYNC_TOKEN（不要分享）。
3. Chrome 浏览器和 Docker 在同一宿主机上时，上述 URL 可直接访问 Docker 映射的端口。Docker 内部将 SYNC_WS_HOST 设为 0.0.0.0 以接受端口映射，宿主机只绑定 127.0.0.1，不对公网开放。
4. Chrome 与 Docker 在不同机器时，需要从 Chrome 所在电脑执行 SSH 端口转发：
   ssh -N -L 9527:127.0.0.1:9527 user@docker-server
   然后仍然在 Chrome 中使用 ws://127.0.0.1:9527。不要在公网上直接开放 9527。

连接后访问 http://127.0.0.1:9528/health，extensionConnected=true 表示 Chrome 已连接（未连接不代表容器服务坏了）。

如果另有宿主机 Chrome DevTools/CDP（如 9222）服务，本 Compose 已提供容器 DNS 名 host.docker.internal；但 Wechatsync 使用浏览器扩展 WebSocket，并不依赖 9222。容器中的 host.docker.internal 对应宿主机网关 IP，不能自动访问仅监听宿主机 127.0.0.1 的第三方 HTTP 端口；Linux 对这些服务请在安全限制下另行配置绑定或专用隧道。

## 三、连接白泽 Manager

Docker Compose 将两个服务加入名为 baize-publishing 的用户自定义桥接网络。MCP 服务别名是 wechatsync-mcp，可供同网络的 Manager 访问：

    http://wechatsync-mcp:9528/sse

如果 Manager 的容器名是 baize-manager，且和本服务运行在同一 Docker Engine，可以执行一次：

    docker network connect baize-publishing baize-manager

再进入 https://chsparta.com/admin/content-settings 设置 MCP SSE 地址和 .env 中的 WECHATSYNC_HTTP_TOKEN（不是 Chrome 桥接 Token），点击测试连接。只访问 localhost 的发布端口时，Manager 自身在另一个容器无法直接连入；加入共享网络是推荐方案。

**注意**：手动 network connect 在 Manager 重新创建容器后会失效。要长期稳定，应在 Manager 自己的 docker-compose.yml 中给 baize-manager 服务加入 external 网络 baize-publishing，并配合自身部署流程使用。若 Manager 和 Chrome/Docker 不在同一服务器，需通过 VPN、受控私网或 HTTPS 代理连接 MCP SSE；勿暴露未加 TLS 的端口到互联网。

## 四、运维管理

    bash manage.sh status
    bash manage.sh logs -f
    bash manage.sh logs --tail=200
    bash manage.sh restart
    bash manage.sh stop
    bash manage.sh start
    bash manage.sh health

也可以使用原生 Docker 命令：

    docker logs -f baize-wechatsync-mcp
    docker inspect -f '{{.State.Health.Status}}' baize-wechatsync-mcp
    docker compose --env-file .env -f compose.yaml ps

修改 .env 后，执行 bash manage.sh start 或 docker compose --env-file .env -f compose.yaml up -d --force-recreate。单纯 docker compose restart 不会重新读取修改过的 env 文件。

## 五、卸载与安全

    bash uninstall.sh
    bash uninstall.sh --purge

普通卸载删除容器但保留 .env（含密钥）、镜像及共享网络。--purge 额外删除 .env；不会影响已加入 baize-publishing 网络的 Manager，也不会修改宿主机 Chrome。

禁止把 .env 提交到仓库或转发给他人，严禁将 9527 WebSocket 或 9528 SSE 不经安全网关直接绑定公网地址。默认端口只在 Docker 宿主机 127.0.0.1 暴露；9529 是 Docker 容器内部 localhost 端口，根本不发布。

目前支持显式直接发布的已接入适配器为知乎、CSDN、掘金；请先测试草稿和封面，再人工验证真实发布，避免误发/重复发。容器联通成功不代表真实目标平台发布已验收。

## 六、验证

安装完成后运行 Node.js 22+ （可在 GitHub Actions 自动执行）：

    node smoke.mjs

测试内容：SSE 未授权请求拒绝、合法 Token 连接成功、宿主机模拟 Chrome WebSocket 能连接容器、连接状态实时回显。不会触发发布动作。

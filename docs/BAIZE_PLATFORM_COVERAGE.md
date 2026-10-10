# Wechatsync 平台覆盖与现有 MCP 服务兼容

## 为什么 README 有平台、源码构建的插件没有

官方完整浏览器插件与公开源码构建包具有不同的适配器集合。上游 v2 的 `.gitmodules` 将 `packages/core/src/adapters/platforms/private` 指向 `wechatsync/wechatsync-private-adapters` 私有仓库，公开源码的 `ADAPTER_CLASSES` 只明确注册19个适配器，其余通过 `import.meta.glob` 从私有目录加载。CI 没有私有仓库源码，因此不会打包这部分实现。更新 Cookie、登录账号或重建相同公开源码均不能补齐它们。

私有集合包含 `toutiao`、`douyin`（图文）、`jianshu`、`yidian`、`sohufocus`、`dayu`、`netease`、`smzdm`、`x`、`xiaohongshu`。官方完整插件的支持说明不能当作 Fork 安装包包含全部适配器的证据。

上游证据：[私有子模块](https://github.com/wechatsync/Wechatsync/blob/v2/.gitmodules)、[扩展注册列表](https://github.com/wechatsync/Wechatsync/blob/v2/packages/extension/src/adapters/index.ts)、[移入私有子模块的提交](https://github.com/wechatsync/Wechatsync/commit/34d41ce7b592a263731511a556ebe1ef0be37398)。

## 已有用户的安装路径

需要上述平台时使用 [Chrome 应用商店官方完整插件](https://chromewebstore.google.com/detail/%E6%96%87%E7%AB%A0%E5%90%8C%E6%AD%A5%E5%8A%A9%E6%89%8B/hchobocdmclopcbnibdnoafilagadion)，或 [官方安装页面](https://www.wechatsync.com/#install) 的 ZIP。不要再安装同一份缺少私有适配器的 Fork 构建包。

1. 在 Chrome 扩展管理页禁用之前解压加载的白泽版，避免两个扩展争用同一 WebSocket 服务。
2. 安装官方完整插件，进入设置，启用 MCP/CLI 桥接，填写原 WebSocket 地址和原浏览器桥接 Token（`WECHATSYNC_TOKEN`）。
3. 同一浏览器登录需要同步的平台。
4. Manager 保持原 SSE 地址和 HTTP Bearer Token（`WECHATSYNC_HTTP_TOKEN`），点击“测试已保存的 MCP 连接”。
5. 在各图文渠道选择 `Wechatsync MCP` 和“仅写入平台草稿箱”。如提示缺少适配器，说明连接的仍是未包含该平台的插件；如提示未登录，则登录对应平台后重新测试。

不需要新增 MCP 容器。官方公开 MCP 客户端与白泽服务沿用 `listPlatforms` / `checkAuth` / `syncArticle` WebSocket 方法，以及 `{results, syncId}` 结果封装；草稿同步可以复用现有服务。

官方完整插件默认同步草稿，不承诺直接公开发布。白泽改造版保留知乎、CSDN、掘金正式发布能力；Manager 只有在实际适配器声明 `direct_publish`、服务支持 `publish/confirmPublish` 且返回已验证结果时才认定正式发布，切换官方插件后请选择草稿模式。公众号每日贴图与每周群发继续使用现有官方接口。

## Manager v2.3.1 映射与预检

23个图文渠道均提供 MCP 选择，且保留各渠道已有投递方式和自动投递开关。`cto51 → 51cto`、`sohu_focus → sohufocus`，其余新增渠道与官方 ID 一致。每次同步前读取实际平台列表，缺少适配器、未登录或无直接发布能力时，在创建远端草稿之前停止并给出对应原因。视频渠道继续排在最后，抖音图文适配器不能代替视频上传。

“识别平台数”表示扩展注册了多少适配器；“已登录数”表示其中多少账号已通过认证。没有登录的平台也应列入前者。模拟协议测试只验证兼容性与拒绝条件，平台真实草稿仍需在用户浏览器及平台账号上核验。

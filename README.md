# MoveCar - 多用户智能挪车系统 (v2.0)

基于 Cloudflare Workers 的智能挪车通知系统，扫码即可通知车主，保护双方隐私。**v2.0 版本现已支持单实例多用户并发使用。**

## 🌐 界面预览

| 请求者页面 | 车主页面 |
|:---:|:---:|
| [🔗 在线预览](https://htmlpreview.github.io/?https://github.com/lesnolie/movecar/blob/main/preview-requester.html) | [🔗 在线预览](https://htmlpreview.github.io/?https://github.com/lesnolie/movecar/blob/main/preview-owner.html) |

---

## ❓ 为什么需要它？

- 🚗 **被堵车却找不到车主** - 干着急没办法。
- 📱 **传统挪车码暴露电话** - 隐私泄露、广告骚扰电话不断。
- 😈 **恶意扫码骚扰** - 有人故意反复扫码打扰车主。
- 🤔 **路人好奇扫码** - 并不需要挪车却触发了通知。

## ✅ 这个系统如何解决？

- 🚀 **多用户架构 (v2.0)** - 一次部署，全家可用。通过 `?u=用户ID` 区分不同车主。
- 🔐 **不暴露电话号码** - 通过微信或 Bark 推送通知联系，完全隐藏真实号。
- 📍 **双向位置共享** - 车主可确认请求者是否真的在车旁，避免无效驱奔。
- ⏳ **智能频率控制** - **每个用户独立计算** 60秒冷却时间，互不干扰，有效防骚扰。
- 🆓 **免费零成本** - 利用 Cloudflare Workers 免费额度，无需服务器，无需备案。

---

## 🔔 为什么推荐推送方式？

### Bark (iOS 推荐)
- 支持「紧急 / 重要 / 警告」通知级别。
- 可自定义通知音效，甚至在**开启勿扰模式**时也能强提醒。

### PushPlus (微信推荐)
- 零门槛，只需微信扫码关注即可接收通知。
- 支持 HTML 格式，点击通知即可直接跳转到确认处理页面。

---

## 🔄 使用流程

### **请求者（路人）**
1. 扫描车上二维码，进入页面。
2. 填写留言（如「挡住出口了」）。
3. **允许获取位置**（若拒绝，系统将强制延迟 30 秒发送，降低恶意扫码动力）。
4. 点击「通知车主」，等待状态更新。

### **车主（您）**
1. 手机即时收到推送通知。
2. 点击通知进入确认页面，查看请求者位置。
3. 点击「我已知晓，马上过去」，系统自动同步状态给请求者。

---

## 🛠️ 部署教程

### 第一步：注册 Cloudflare
打开 [dash.cloudflare.com](https://dash.cloudflare.com/) 注册并登录。

### 第二步：创建 Worker
1. 进入「Workers & Pages」 -> 「Create」 -> 「Create Worker」。
2. 名称填 `movecar`，点击「Deploy」。
3. 点击「Edit code」，删除默认代码，将 **`worker.js`** 全部内容粘贴进去，点击右上角「Deploy」。

### 第三步：配置 KV 存储 (必须)
1. 点击左侧菜单「KV」。
2. 创建一个命名空间，名称填：`MOVE_CAR_STATUS`。
3. 回到你的 Worker -> 「Settings」 -> 「Bindings」。
4. 添加「KV Namespace」，变量名填 `MOVE_CAR_STATUS`，选择刚才创建的空间，保存部署。

### 第四步：配置环境变量 (多用户关键)
在 Worker 的「Settings」 -> 「Variables and Secrets」中添加：

#### 1. 默认全局变量 (可选)
- `BARK_URL`：默认推送地址。
- `PUSHPLUS_TOKEN`：默认微信令牌。

#### 2. 用户专属变量 (强烈推荐)
**格式：`变量名_用户ID` (ID需大写)**。例如你的 ID 是 `xiaowang`：
- `PUSHPLUS_TOKEN_XIAOWANG`：该用户的专属令牌（如PushPlus或者Bark的TOKEN）。
- `CAR_TITLE_XIAOWANG`：显示的车辆/车主信息（如：粤B·88888）。
- `EXTERNAL_URL`：填入你的反代备案域名（例如 https://xx.xxx.com）-（可选，注意：带上https，末尾不要带斜杠)
- `PHONE_NUMBER_XIAOWANG`：该车主的备用电话-通知车主后没有回应的时候可以直接拨打电话（可选）。

### 第五步：绑定域名 (可选)
在「Settings」 -> 「Domains & Routes」中绑定你的自定义域名。

---

## 🎨 制作挪车码

### 1. 生成链接
你的专属链接为：`https://你的域名/?u=你的ID`
例如：`https://movecar.xxxx.workers.dev/?u=xiaowang`

### 2. 生成二维码
使用 [草料二维码](https://cli.im/) 将链接转为二维码下载。

### 3. 美化与打印
- 使用 **Midjourney** 或 **ChatGPT (DALL-E)** 生成精美的挪车牌背景。
- 将二维码组合排版，添加文字：**「扫码通知车主挪车」**。
- 打印、过塑，贴在挡风玻璃处。

---

## 🛡️ 安全与隐私
- **自动清理**：所有位置和状态信息在 1 小时后从 KV 中自动删除。
- **并发安全**：v2.0 修复了语法陷阱，支持高并发环境下的稳定运行。

## 📄 许可证
本项目采用 [MIT License](LICENSE) 开源。

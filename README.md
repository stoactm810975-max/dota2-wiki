# DOTA 2 百科全书 (Patch 7.41f 中文 Wiki)

这是一个专为 **DOTA 2 7.41f 版本** 设计的高保真、现代化中文交互式百科全书与数据分析网站。项目采用纯静态架构开发，已完全配置好 **GitHub Pages** 与 **GitHub Actions** 自动化部署规则，可直接上传到 GitHub 仓库开放给所有玩家与社区使用。

---

## 🌟 核心功能一览

1. **英雄图鉴（全部 127 位英雄）**
   - **高清头像与全身立绘**：收录 Valve 官方全套 127 位英雄高清头像、全身透明立绘（Render PNG），并支持一键切换 Valve 原版 WebM 动态全身立绘。
   - **等级 1~30 实时属性计算器**：拖动滑块或快捷选择 1/6/12/18/25/30 级，即可根据力量、敏捷、智力主属性成长公式，实时算出英雄当前的精确攻击力、血量、蓝量、双抗、攻速与每秒恢复数值。
   - **技能全解与精确数值**：收录所有主动、被动、先天技能（Innate），精准展示基础技能数值，并区分标注阿哈利姆神杖（Scepter）和阿哈利姆魔晶（Shard）升级效果。
   - **天赋树系统**：直观展示 10 / 15 / 20 / 25 级左右两侧天赋的具体属性数值。

2. **走势与攻略（大数据实战指南）**
   - **全分段胜率走势**：涵盖从「先锋」、「卫士」到「万古流芳」、「超凡/冠绝」等 7 大天梯分段以及加速模式（Turbo）的胜率与场次数据。
   - **常见位置分布**：统计 1~5 号位（优势路核心、中单、劣势路、游走/半辅助、纯辅助）的出场占比与对局胜率。
   - **分阶段实战出装**：出门装备（Starting）、前期对线（Early）、核心装备（Core）、后期神装与备选（Luxury）以及契合度最高的中立装备推荐。
   - **技能加点路线**：提供前 15 级天梯常规主流加点顺序。

3. **物品百科（269 件物品）**
   - **完整分类**：消耗品、基础配件、常用合成、辅助法器、武器神装、圣物秘宝、肉山掉落以及 1~5 级中立物品。
   - **合成配方树**：清晰展示向下配件需求（含合成卷轴费用）与向上进阶神装路线。
   - **装备核心契合英雄榜**：直观展示哪些英雄最适合出这件装备及其对应胜率。

4. **7.41f 平衡性补丁中心**
   - 收录 7.41f、7.41e、7.41d、7.41c、7.41b、7.41a 以及 7.41 大版本更新历史。
   - 标注所有 7.41f 改动的英雄（如敌法师、莉娜、树精卫士等）与物品，卡片与列表均有专属徽章标记。

5. **全局快速搜索**
   - 支持全站全局搜索，快捷键 `/` 或 `Ctrl + K` 随时唤醒。
   - 支持中英文名称、缩写模糊搜索英雄与物品。

---

## 🚀 部署至 GitHub Pages 指南

本项目完全遵循 GitHub 静态网站规范，开箱即用。

### 方式一：直接使用 GitHub Pages 静态托管（推荐）

1. **创建 GitHub 仓库**
   - 在 GitHub 上新建一个仓库（例如命名为 `dota2-wiki` 或 `<your-username>.github.io`）。
2. **推送代码**
   ```bash
   git init
   git add .
   git commit -m "feat: initial release of Dota 2 Wiki Patch 7.41f"
   git branch -M main
   git remote add origin https://github.com/<your-username>/<your-repo>.git
   git push -u origin main
   ```
3. **开启 GitHub Pages**
   - 进入 GitHub 仓库页面 -> 点击 **Settings** -> **Pages**。
   - **Source** 选择 **GitHub Actions**（仓库已内置 `.github/workflows/deploy.yml`）。
   - 或者 **Source** 选择 **Deploy from a branch**，分支选择 `main`，目录选择 `/ (root)`，点击 **Save** 即可。
4. 几分钟后，即可通过 `https://<your-username>.github.io/<your-repo>/` 在全球公开访问！

---

## 🛠️ 本地预览与数据更新

- **直接本地预览**：双击直接在浏览器打开 `index.html` 即可完整浏览全部内容。
- **重新爬取最新数据**：
  若未来发布新小版本（如 7.41g），可运行脚本自动更新：
  ```bash
  python scripts/build_data.py
  ```

---

## 📁 目录结构

```text
d:\DOTA2 wiki
├── .github/workflows/deploy.yml  # GitHub Actions 自动化部署配置
├── .nojekyll                     # 禁用 Jekyll 静态处理，确保资源直接加载
├── index.html                    # 网站主入口（语义化、响应式布局）
├── css/
│   └── style.css                 # 沉浸式暗黑黑金电竞风格样式
├── js/
│   └── app.js                    # 前端交互、属性计算器、搜索与弹窗渲染
├── data/
│   ├── wiki_data.js              # 全量静态数据（带全局变量，完美兼容离线与无跨域限制部署）
│   └── wiki_data.json            # JSON 格式数据源
├── scripts/
│   └── build_data.py             # 官方 API 与 OpenDota 数据清洗同步脚本
└── README.md                     # 本说明文档
```

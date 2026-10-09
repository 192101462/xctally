# xctally · AI 出图 Prompt 集合

> 原型本身（UI、图标）已经由代码生成，不需要外部模型。
> 这份文件留给**代码不擅长的部分**：商店截图背景、引导页插画、营销图。
>
> 用法：直接复制英文段给 Midjourney / SD / 即梦 / 可灵 / GPT-Image 等。
> 中文段是给支持中文的模型（或你自己微调）用的。

## 全局风格锚点（每次都要带上）

**English style anchor**
```
minimal iOS design language, soft rounded shapes, generous white space,
subtle soft gradients, no hard edges, no textures, no noise,
Apple keynote aesthetic, pastel blue and warm neutral palette,
soft studio lighting, high key, clean, premium, vector-like smoothness,
no text, no words, no lettering, no logo, no watermark
```

**中文风格锚点**
```
极简 iOS 设计语言，圆润造型，大量留白，柔和渐变，无硬边、无噪点，
苹果发布会审美，浅蓝与暖中性色，柔光高调，干净高级，矢量般平滑，
画面中不要任何文字、字母、标志或水印
```

---

## 1. 应用图标（备选方案）

我已经用 SVG 手写了图标（`design/icon.svg`）。如果你想试试生成式方案：

```
iOS app icon, rounded square, soft blue to indigo gradient background,
a single minimal white rounded card floating in the center,
a smooth downward curve drawn on the card suggesting a declining daily cost,
one small warm orange dot at the end of the curve,
flat vector, extremely simple, high contrast at small size, centered composition,
no text, no letters, no numbers --ar 1:1
```

要点：**必须在 prompt 里强调 "simple / high contrast at small size"**，
否则模型会堆细节，缩到 60px 就糊成一团。

---

## 2. 空状态插画（4 张，风格统一）

用在"没有数据 / 没有提醒"的位置，尺寸建议 320×320，背景透明。

**2.1 没有临期物品**
```
minimal 3d illustration, a single soft white ceramic bowl with a green leaf,
floating above a pale blue rounded platform, extremely clean, soft shadows,
pastel palette, clay render, centered, transparent background, no text --ar 1:1
```

**2.2 没有记录物品**
```
minimal 3d illustration, three empty rounded white cards stacked in a fan,
one pale blue rounded tag beside them, soft shadows, pastel palette,
clay render, centered, transparent background, no text --ar 1:1
```

**2.3 能源数据为空**
```
minimal 3d illustration, a small rounded white electricity meter with a soft
blue dial, two tiny floating rounded bars beside it, clay render, pastel,
soft shadows, centered, transparent background, no text --ar 1:1
```

**2.4 严重超支 / 警示**
```
minimal 3d illustration, a soft rounded wallet with one warm orange coin
beside it, gentle warning mood but not alarming, clay render, pastel palette,
soft shadows, centered, transparent background, no text --ar 1:1
```

---

## 3. 商店截图背景（App Store / 应用商店）

商店要求 6.7"/6.5" 竖版截图（1290×2796 等），**文字必须自己排版**，
所以只让模型出**背景**，再在 Figma / Keynote 里叠 UI 截图和文案。

```
abstract minimal background for an app store screenshot, portrait,
soft vertical gradient from very light blue to warm off-white,
two or three large blurred rounded shapes drifting in the corners,
extremely subtle, low contrast, lots of empty space in the middle,
iOS aesthetic, no text, no objects, no noise --ar 9:19
```

深色版把 `light blue to warm off-white` 换成
`near black to deep navy`，并加一句 `very low contrast, subtle glow`。

---

## 4. 引导页 / 首启插画（3 张）

**4.1 记录你拥有的**
```
minimal isometric illustration, a neat grid of small rounded objects
(hair clip, milk bottle, umbrella, laptop) arranged in a tidy row on pale
rounded tiles, flat vector with soft shadows, pastel palette, light background,
no text --ar 4:3
```

**4.2 看见每天的成本**
```
minimal flat vector illustration, a smooth declining curve, a small rounded
marker dot at the end, faint grid lines behind, blue and warm orange accents,
lots of white space, light background, no text, no numbers --ar 4:3
```

**4.3 看懂每月用量**
```
minimal flat vector illustration, twelve rounded vertical bars of varying
height, the last one highlighted in blue, faint baseline, pastel palette,
lots of white space, light background, no text, no numbers --ar 4:3
```

---

## 5. 反面清单（生成时明确排除）

```
不要：写实照片、玻璃拟态重质感、霓虹赛博、强烈投影、复杂纹理、
      渐变噪点、3D 拟物、拟人吉祥物、任何文字与数字
不要：把 UI 控件画进插画里（会和真实界面打架）
```

---

## 6. 如果要让模型直接出 UI 稿

可以做，但**不要指望它能对**，拿来找灵感就行：

```
mobile app UI design, three iOS screens side by side, minimal style,
soft blue accents, large rounded cards, grouped list rows, big bold numbers,
SF Pro typography, light gray background, generous white space, dribbble shot,
high fidelity --ar 16:9
```

真正落地还是用 `prototype/` 里这份可交互原型改，改一行 CSS 比重新生一张图快得多。

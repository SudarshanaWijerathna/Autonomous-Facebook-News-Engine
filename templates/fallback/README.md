# Fallback Template Backgrounds

This directory holds pre-rendered 1080×1080 PNG backgrounds used when AI image generation fails.

## Required files

Create one PNG per category (1080×1080):

| Filename | Category | Suggested style |
|---|---|---|
| `sri-lanka.png` | Sri Lanka | Aerial shot of Sri Lankan landscape, or flag motif, dark overlay |
| `world.png` | World | Globe / abstract world map in muted tones |
| `ai---tech.png` | AI & Tech | Abstract tech/circuit pattern, deep blue/purple tones |
| `business.png` | Business | Clean minimal geometric pattern, dark navy |
| `sports.png` | Sports | Dynamic blur/motion abstract, dark orange |
| `standard.png` | Default | Dark slate gradient — used when no category match |
| `default.png` | Ultimate fallback | Plain dark background |

## Design guidelines

- **1080×1080 exactly**
- **Dark enough** for white text legibility (images will have a gradient scrim added, but start dark)
- **No text** in the image — text is composited by the flyer renderer
- **Bottom third should be especially dark** — that's where the scrim + text goes

## Tools

You can create these with any tool:
- Midjourney / DALL·E / Stable Diffusion (generate, then export at 1080×1080)
- Photoshop / Illustrator (your existing BriefSphere brand toolkit)
- Canva (free, export as PNG)

## Note on naming

The filename is derived from the category name:
- `"Sri Lanka"` → `sri-lanka.png`
- `"AI & Tech"` → `ai---tech.png`
- `"World"` → `world.png`
- etc.

The image generator does: `category.toLowerCase().replace(/[^a-z]/g, '-') + '.png'`

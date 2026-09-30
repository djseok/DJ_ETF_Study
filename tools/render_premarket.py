"""
🌅 개장 전 예상가 이미지 (A: 막대그래프, B: 표) 그리기 — GitHub Actions 에서 실행

관리시트 Apps Script(premarket_alert.gs)가 계산한 값을 repository_dispatch 로 넘기면
alerts/{stamp}_A.png, alerts/{stamp}_B.png 를 만들고 14일 지난 이미지는 지웁니다.

  로컬 확인: python tools/render_premarket.py --sample
  실제:     PREMARKET_DATA='{"title":..., "rows":[...]}' python tools/render_premarket.py
"""
import glob
import json
import os
import sys
from datetime import datetime, timedelta

import matplotlib

matplotlib.use("Agg")
import matplotlib.image as mpimg  # noqa: E402
import matplotlib.pyplot as plt  # noqa: E402
from matplotlib import font_manager as fm  # noqa: E402
from matplotlib.patches import FancyBboxPatch, Rectangle  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, "alerts")
LOGO = os.path.join(ROOT, "assets", "invest_if_logo.png")

# ---------- 글꼴 (Noto Sans CJK: 우분투 fonts-noto-cjk) ----------
for f in glob.glob("/usr/share/fonts/**/NotoSansCJK*.ttc", recursive=True):
    fm.fontManager.addfont(f)
plt.rcParams["font.family"] = "Noto Sans CJK JP"
plt.rcParams["axes.unicode_minus"] = False

# ---------- 색 ----------
UP, DN = "#e34948", "#2a78d6"            # 상승 빨강 · 하락 파랑 (국내 관례)
INK, SUB, MUTE = "#0b0b0b", "#52514e", "#8a8984"
BG, ZEBRA = "#fcfcfb", "#f3f2ef"
DARK, DARK2, EDGE = "#1c1d20", "#2a2b2f", "#3a3b40"
ON, ON2 = "#ffffff", "#c3c2b7"
UP_ON_DARK, DN_ON_DARK, AMBER = "#ff8a8a", "#7fb3ff", "#f2b84b"

W, HEAD, FOOT = 10.8, 1.55, 0.72

SAMPLE = {
    "stamp": "sample", "title": "10/1(목) 07:30 기준", "vix": 21.4, "note": "", "domestic": 8,
    "chips": [["나스닥 선물", 0.42], ["S&P 선물", 0.31], ["원/달러", -0.2]],
    "rows": [
        ["HANARO 미국AI메모리반도체TOP4+", 10115, 4.35, 10555, "SELL"], ["KODEX 미국반도체", 55255, 1.84, 56272, ""],
        ["TIME 미국나스닥100액티브", 47135, 1.62, 47899, ""], ["RISE 미국나스닥100", 30260, 0.95, 30547, ""],
        ["KODEX 미국나스닥100데일리커버드콜OTM", 8775, 0.71, 8837, ""], ["TIGER 미국배당다우존스", 14225, -0.18, 14199, ""],
        ["RISE 미국은행TOP10", 11660, -0.61, 11589, ""], ["RISE 미국천연가스밸류체인", 11895, -2.24, 11629, "BUY"],
    ],
}


def frame(H, d, kind):
    fig = plt.figure(figsize=(W, H), dpi=100, facecolor=BG)
    r = fig.canvas.get_renderer()
    # 머리 (다크)
    fig.add_artist(Rectangle((0, 1 - HEAD / H), 1, HEAD / H, transform=fig.transFigure, color=DARK, zorder=0))
    fig.text(0.035, 1 - 0.30 / H, "INVEST IF  ·  " + kind, fontsize=11, color=ON2, va="top", fontweight="bold")
    fig.text(0.035, 1 - 0.58 / H, d["title"], fontsize=22, color=ON, va="top", fontweight="bold")
    chips = [(lab, val, None) for lab, val in d.get("chips", [])]
    if d.get("vix", 0) >= 20:
        chips.append(("VIX", d["vix"], "변동성 경계"))
    if d.get("note"):
        chips.append((d["note"], None, None))
    x, pad, yc = 0.035, 0.012, 1 - 1.21 / H
    for lab, val, tag in chips:
        t1 = fig.text(x + pad, yc, lab, fontsize=11, color=ON2 if not tag else AMBER, va="center", fontweight="bold" if tag else "normal")
        w = t1.get_window_extent(r).width / fig.bbox.width
        if val is not None:
            if tag:
                txt, col = f"{val:.1f} {tag}", AMBER
            else:
                txt, col = f"{val:+.2f}%", (ON2 if val == 0 else (UP_ON_DARK if val > 0 else DN_ON_DARK))
            t2 = fig.text(x + pad + w + 0.008, yc, txt, fontsize=11.5, va="center", fontweight="bold", color=col)
            w += 0.008 + t2.get_window_extent(r).width / fig.bbox.width
        w += 2 * pad
        fig.add_artist(FancyBboxPatch((x, yc - 0.16 / H), w, 0.32 / H, boxstyle="round,pad=0,rounding_size=0.012",
                                      transform=fig.transFigure, fc=DARK2, ec=AMBER if tag else EDGE, lw=1, zorder=0.5))
        x += w + 0.012
    if os.path.exists(LOGO):
        s = 1.2 / H
        a = fig.add_axes([0.97 - 1.2 / W, 1 - 0.18 / H - s, 1.2 / W, s])
        a.imshow(mpimg.imread(LOGO))
        a.axis("off")
    # 꼬리 (다크)
    fig.add_artist(Rectangle((0, 0), 1, FOOT / H, transform=fig.transFigure, color=DARK, zorder=0))
    fig.text(0.035, FOOT / H * 0.5, "투자, 나였다면", fontsize=13, color=ON, va="center", fontweight="bold")
    fig.text(0.035 + 1.28 / W, FOOT / H * 0.5, "YouTube @invest.if.me", fontsize=11.5, color=ON2, va="center")
    fig.text(0.965, FOOT / H * 0.5, "투자 판단 참고용 · 개별 투자 자문이 아닙니다", fontsize=10, color="#9a9990", va="center", ha="right")
    return fig


def badge(ax_or_fig, x, y, sg, **kw):
    ax_or_fig.text(x, y, sg, ha="center", va="center", fontsize=10.5, color="white", fontweight="bold",
                   bbox=dict(boxstyle="round,pad=0.25", fc=DN if sg == "BUY" else UP, ec="none"), **kw)


def draw_a(d, path):
    rows = d["rows"]
    n = max(len(rows), 1)
    body = 0.52 * n + 0.95
    H = HEAD + body + FOOT
    fig = frame(H, d, "개장 전 예상 등락률")
    ax = fig.add_axes([0.42, (FOOT + 0.55) / H, 0.42, (body - 0.85) / H])
    ax.set_facecolor("none")
    for i, (nm, close, pct, price, sg) in enumerate(rows):
        y = n - 1 - i
        ax.barh(y, pct, height=0.58, color=UP if pct >= 0 else DN, zorder=2)
        ax.text(pct + (0.08 if pct >= 0 else -0.08), y, f"{pct:+.2f}%  {price:,}", va="center",
                ha="left" if pct >= 0 else "right", fontsize=12, color=INK, zorder=3)
        ax.text(-0.035, y, nm, transform=ax.get_yaxis_transform(), ha="right", va="center", fontsize=12.5, color=INK,
                fontweight="bold" if sg else "normal")
        if sg:
            badge(ax, -0.73, y, sg, transform=ax.get_yaxis_transform())
    ax.axvline(0, color=MUTE, lw=1, zorder=1)
    lim = max([abs(r[2]) for r in rows] + [0.5]) * 1.6
    ax.set_xlim(-lim, lim)
    ax.set_ylim(-0.5, n - 0.5)
    ax.set_yticks([])
    ax.set_xticks([])
    for sp in ax.spines.values():
        sp.set_visible(False)
    fig.canvas.draw()
    for i in range(0, n, 2):
        y = n - 1 - i
        (_, y0), (_, y1) = ax.transData.transform([(0, y - 0.5), (0, y + 0.5)])
        fig.add_artist(Rectangle((0.03, y0 / fig.bbox.height), 0.94, (y1 - y0) / fig.bbox.height,
                                 transform=fig.transFigure, color=ZEBRA, zorder=0))
    tail = f"국내 ETF {d['domestic']}개는 개장 전 변동이 없어 제외  ·  " if d.get("domestic") else ""
    fig.text(0.035, (FOOT + 0.22) / H, tail + "막대 = 예상 등락률 (빨강 상승 · 파랑 하락)  ·  숫자 = 예상 등락률 · 오늘 예상가",
             fontsize=10, color=MUTE)
    fig.savefig(path, facecolor=BG)
    plt.close(fig)


def draw_b(d, path):
    rows = d["rows"]
    rh = 0.46
    body = rh * (len(rows) + 1) + 0.9
    H = HEAD + body + FOOT
    fig = frame(H, d, "개장 전 예상가")
    y0 = 1 - (HEAD + 0.42) / H
    for t, x, ha in [("종목명", 0.035, "left"), ("등락률", 0.66, "right"), ("전일종가", 0.79, "right"), ("오늘 예상가", 0.965, "right")]:
        fig.text(x, y0, t, fontsize=12, color=SUB, ha=ha, fontweight="bold", va="center")
    fig.add_artist(plt.Line2D([0.03, 0.97], [y0 - 0.25 / H, y0 - 0.25 / H], color=INK, lw=1.2))
    for i, (nm, close, pct, price, sg) in enumerate(rows):
        y = y0 - (i + 1) * rh / H - 0.06 / H
        if i % 2 == 0:
            fig.add_artist(Rectangle((0.03, y - rh / 2 / H), 0.94, rh / H, transform=fig.transFigure, color=ZEBRA, zorder=0))
        col = UP if pct > 0 else (DN if pct < 0 else INK)
        fig.text(0.035, y, nm, fontsize=12.5, color=INK, va="center", fontweight="bold" if sg else "normal")
        if sg:
            badge(fig, 0.535, y, sg)
        arrow = "▲" if pct > 0 else ("▼" if pct < 0 else "–")
        fig.text(0.66, y, f"{arrow} {abs(pct):.2f}%", fontsize=12.5, color=col, va="center", ha="right", fontweight="bold")
        fig.text(0.79, y, f"{close:,}", fontsize=12.5, color=SUB, va="center", ha="right")
        fig.text(0.965, y, f"{price:,}", fontsize=13, color=INK, va="center", ha="right", fontweight="bold")
    if d.get("domestic"):
        fig.text(0.035, (FOOT + 0.22) / H, f"국내 ETF {d['domestic']}개는 개장 전 변동이 없어 제외 (장중 대시보드)",
                 fontsize=10, color=MUTE)
    fig.savefig(path, facecolor=BG)
    plt.close(fig)


def cleanup(days=14):
    cutoff = (datetime.utcnow() + timedelta(hours=9) - timedelta(days=days)).strftime("%Y-%m-%d")
    for p in glob.glob(os.path.join(OUT_DIR, "*.png")):
        name = os.path.basename(p)
        if name[:10] < cutoff and name[:4].isdigit():
            os.remove(p)


def main():
    if "--sample" in sys.argv:
        d = SAMPLE
    else:
        d = json.loads(os.environ["PREMARKET_DATA"])
    os.makedirs(OUT_DIR, exist_ok=True)
    d["rows"] = [[str(r[0]), int(r[1] or 0), float(r[2] or 0), int(r[3] or 0), str(r[4] or "")] for r in d.get("rows", [])]
    a = os.path.join(OUT_DIR, f"{d['stamp']}_A.png")
    b = os.path.join(OUT_DIR, f"{d['stamp']}_B.png")
    draw_a(d, a)
    draw_b(d, b)
    if d["stamp"] != "sample":  # alerts/view.html 이 주소에 날짜가 없을 때 가장 최근 것을 보여줌
        with open(os.path.join(OUT_DIR, "latest.json"), "w") as f:
            json.dump({"stamp": d["stamp"]}, f)
    cleanup()
    print("✅", a, b)


if __name__ == "__main__":
    main()

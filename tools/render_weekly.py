"""
📅 주간 리포트 이미지 (금요일 저녁) — GitHub Actions 에서 실행
관리시트 Apps Script(weekly_report.gs)가 repository_dispatch(weekly-image)로 데이터를 넘기면
alerts/{stamp}_W.png 를 그립니다. 디자인은 개장 전 알림(render_premarket.py)과 같은 머리·꼬리.

  로컬 확인: python tools/render_weekly.py --sample
"""
import json
import os
import sys

from render_premarket import (BG, INK, MUTE, OUT_DIR, SUB, UP, DN, ZEBRA, W, HEAD, FOOT,  # noqa: F401
                              cleanup, frame, plt, Rectangle)

SAMPLE = {
    "stamp": "sample", "title": "10/2(금) 주간 리포트", "chips": [["9/28 ~ 10/2", None], ["코스피", 1.24], ["나스닥", 0.85], ["원/달러", -0.31]],
    "etfs": [["HANARO 미국AI메모리반도체TOP4+", 4.21, 10540], ["KODEX 미국반도체", 2.35, 56990], ["RISE 미국나스닥100", 1.12, 30600],
             ["TIGER 미국배당다우존스", -0.35, 14170], ["KODEX 금융고배당TOP10타겟위클리커버드콜", -1.8, 11490], ["TIGER 증권", -3.1, 11420]],
    "members": [["D", 12450000, 8.42, 0.61, 86350, 11.9], ["S", 5320000, 3.1, -0.2, 0, 4.2], ["J", 2110000, 11.8, 1.05, 924, 12.4]],
    "divWeek": 87274, "divNext": [["10/6(화)", "KODEX 미국배당커버드콜액티브", 9900], ["10/8(목)", "TIGER 리츠부동산인프라", 3300]], "divNextTotal": 13200,
    "acc": {"days": 5, "mae": 0.34, "hit": 78}, "signals": {"count": 3, "items": [["9/30", "KODEX 미국반도체", "BUY", -1.62]]},
    "status": {"text": "자동화 이번 주: 07:30 알림 5/5 · 16:10 기록 5/5 · 장중 신호 5/5 · 보유종목 5/5 · 배당주기 4/5", "ok": False},
}


def section(fig, H, y_top, title, sub=""):
    """섹션 제목 줄. 반환: 제목 아래 y (인치, 위에서부터)"""
    fig.text(0.035, 1 - (y_top + 0.22) / H, title, fontsize=15, color=INK, fontweight="bold", va="center")
    if sub:
        fig.text(0.965, 1 - (y_top + 0.22) / H, sub, fontsize=10, color=MUTE, va="center", ha="right")
    fig.add_artist(plt.Line2D([0.03, 0.97], [1 - (y_top + 0.45) / H] * 2, color=INK, lw=1.1))
    return y_top + 0.55


def won(v):
    return f"{int(round(v)):,}원"


def draw(d, path):
    etfs = sorted(d.get("etfs", []), key=lambda r: -r[1])
    members = d.get("members", [])
    div_next = d.get("divNext", [])[:5]
    sig_items = d.get("signals", {}).get("items", [])[:4]
    rh = 0.42
    h_etf = 0.55 + rh * max(len(etfs), 1) + 0.2
    h_mem = 0.55 + rh * (len(members) + 1) + 0.25 if members else 0
    h_bottom = 0.55 + max(2.0, 0.9 + rh * max(len(div_next), len(sig_items) + 2)) + 0.2
    status = d.get("status") or {}
    H = HEAD + 0.25 + h_etf + h_mem + h_bottom + FOOT + 0.2 + (0.45 if status.get("text") else 0)
    fig = frame(H, d, "주간 리포트")

    # 1) 관리 ETF 주간 등락
    y = section(fig, H, HEAD + 0.25, "관리 ETF 주간 등락", "지난주 금요일 종가 → 이번 주 종가")
    n = max(len(etfs), 1)
    ax = fig.add_axes([0.45, 1 - (y + rh * n) / H, 0.38, rh * n / H])
    ax.set_facecolor("none")
    for i, (nm, pct, close) in enumerate(etfs):
        yy = n - 1 - i
        if i % 2 == 0:
            fig.add_artist(Rectangle((0.03, 1 - (y + rh * (i + 1)) / H), 0.94, rh / H, transform=fig.transFigure, color=ZEBRA, zorder=0))
        ax.barh(yy, pct, height=0.6, color=UP if pct >= 0 else DN, zorder=2)
        ax.text(-0.04, yy, nm, transform=ax.get_yaxis_transform(), ha="right", va="center", fontsize=11.5, color=INK)
        ax.text(1.03, yy, f"{pct:+.2f}%", transform=ax.get_yaxis_transform(), ha="left", va="center", fontsize=11.5,
                fontweight="bold", color=UP if pct > 0 else (DN if pct < 0 else INK))
    ax.axvline(0, color=MUTE, lw=1, zorder=1)
    lim = max([abs(r[1]) for r in etfs] + [0.5]) * 1.15
    ax.set_xlim(-lim, lim)
    ax.set_ylim(-0.5, n - 0.5)
    ax.axis("off")
    y += rh * n + 0.2

    # 2) 멤버 현황
    if members:
        y = section(fig, H, y, "멤버 현황", "수익률 = 평단 대비 현재가 · 배당 포함 = 받은 배당(세후) 더함 · 변화 = 지난주 대비 %p")
        cols = [("멤버", 0.035, "left"), ("평가액", 0.34, "right"), ("수익률", 0.49, "right"), ("배당 포함", 0.65, "right"), ("변화", 0.77, "right"), ("이번 주 배당", 0.965, "right")]
        yy = y + rh / 2
        for t, x, ha in cols:
            fig.text(x, 1 - yy / H, t, fontsize=11, color=SUB, fontweight="bold", ha=ha, va="center")
        for i, row in enumerate(members):
            nm, cur, ret, chg, dv = row[:5]
            wd = row[5] if len(row) > 5 else None
            yy = y + rh * (i + 1.5)
            if i % 2 == 0:
                fig.add_artist(Rectangle((0.03, 1 - (yy + rh / 2) / H), 0.94, rh / H, transform=fig.transFigure, color=ZEBRA, zorder=0))
            fig.text(0.035, 1 - yy / H, nm, fontsize=12.5, color=INK, fontweight="bold", va="center")
            fig.text(0.34, 1 - yy / H, won(cur), fontsize=12, color=INK, va="center", ha="right")
            fig.text(0.49, 1 - yy / H, f"{ret:+.2f}%", fontsize=12, va="center", ha="right", fontweight="bold", color=UP if ret >= 0 else DN)
            fig.text(0.65, 1 - yy / H, "–" if wd is None else f"{wd:+.2f}%", fontsize=12, va="center", ha="right", fontweight="bold",
                     color=SUB if wd is None else (UP if wd >= 0 else DN))
            ctxt = "–" if chg is None else f"{chg:+.2f}"
            fig.text(0.77, 1 - yy / H, ctxt, fontsize=11.5, va="center", ha="right", color=SUB if chg is None else (UP if chg >= 0 else DN))
            fig.text(0.965, 1 - yy / H, won(dv) if dv else "–", fontsize=12, va="center", ha="right", color="#0f7a4f" if dv else SUB, fontweight="bold" if dv else "normal")
        y += rh * (len(members) + 1) + 0.25

    # 3) 배당 | 예측·신호 (두 칸)
    top = y
    fig.text(0.035, 1 - (top + 0.22) / H, "배당", fontsize=15, color=INK, fontweight="bold", va="center")
    fig.add_artist(plt.Line2D([0.03, 0.49], [1 - (top + 0.45) / H] * 2, color=INK, lw=1.1))
    fig.text(0.035, 1 - (top + 0.85) / H, "이번 주 받은 배당 (클럽 합계)", fontsize=10.5, color=SUB, va="center")
    fig.text(0.47, 1 - (top + 0.85) / H, won(d.get("divWeek", 0)), fontsize=15, color="#0f7a4f", fontweight="bold", va="center", ha="right")
    fig.text(0.035, 1 - (top + 1.3) / H, f"다음 주 예정 {won(d.get('divNextTotal', 0))}", fontsize=10.5, color=SUB, va="center")
    for i, (dt, nm, amt) in enumerate(div_next):
        yy = top + 1.3 + rh * (i + 1)
        short = nm if len(nm) <= 16 else nm[:15] + "…"
        fig.text(0.035, 1 - yy / H, f"{dt}  {short}", fontsize=10.5, color=INK, va="center")
        fig.text(0.47, 1 - yy / H, won(amt), fontsize=10.5, color=INK, va="center", ha="right")
    if not div_next:
        fig.text(0.035, 1 - (top + 1.3 + rh) / H, "예정된 배당 없음", fontsize=10.5, color=MUTE, va="center")

    x0 = 0.53
    fig.text(x0, 1 - (top + 0.22) / H, "예측 · 신호", fontsize=15, color=INK, fontweight="bold", va="center")
    fig.add_artist(plt.Line2D([x0 - 0.005, 0.97], [1 - (top + 0.45) / H] * 2, color=INK, lw=1.1))
    acc = d.get("acc", {}) or {}
    if acc.get("days"):
        fig.text(x0, 1 - (top + 0.85) / H, f"07:30 예측 {acc['days']}일", fontsize=10.5, color=SUB, va="center")
        fig.text(0.965, 1 - (top + 0.85) / H, f"오차 {acc['mae']:.2f}%p · 방향 {acc['hit']:.0f}%", fontsize=12.5, color=INK, fontweight="bold", va="center", ha="right")
    else:
        fig.text(x0, 1 - (top + 0.85) / H, "07:30 예측 기록 대기 중", fontsize=10.5, color=MUTE, va="center")
    sg = d.get("signals", {}) or {}
    fig.text(x0, 1 - (top + 1.3) / H, f"장중 신호 {sg.get('count', 0)}건", fontsize=10.5, color=SUB, va="center")
    for i, (dt, nm, side, pct) in enumerate(sig_items):
        yy = top + 1.3 + rh * (i + 1)
        short = nm if len(nm) <= 14 else nm[:13] + "…"
        fig.text(x0, 1 - yy / H, f"{dt}  {short}", fontsize=10.5, color=INK, va="center")
        fig.text(0.965, 1 - yy / H, f"{'매수' if side == 'BUY' else '매도'} {pct:+.2f}%", fontsize=10.5, va="center", ha="right",
                 fontweight="bold", color=DN if side == "BUY" else UP)

    if status.get("text"):
        ok = status.get("ok", True)
        fig.text(0.035, (FOOT + 0.3) / H, ("✓ " if ok else "⚠ ") + status["text"], fontsize=10.5,
                 color=MUTE if ok else "#b45309", fontweight="normal" if ok else "bold", va="center")

    fig.savefig(path, facecolor=BG)
    plt.close(fig)


def main():
    d = SAMPLE if "--sample" in sys.argv else json.loads(os.environ["WEEKLY_DATA"])
    os.makedirs(OUT_DIR, exist_ok=True)
    path = os.path.join(OUT_DIR, f"{d['stamp']}_W.png")
    draw(d, path)
    cleanup()
    print("✅", path)


if __name__ == "__main__":
    main()

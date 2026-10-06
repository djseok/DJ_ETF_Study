/**
 * 🚨 Apps Script 자동 배포 실패 알림 — 관리시트 Apps Script (premarket_alert.gs 와 같은 프로젝트)
 *
 * GitHub Actions 'Apps Script 배포'(gas_deploy.yml)가 실패하면 카톡(나에게 보내기)으로 한 번 알려요.
 * 배포가 멈추면 편집기는 옛 코드로 계속 돌기 때문에, Actions 화면을 보지 않아도 알 수 있게.
 *   · 따로 트리거 없음: 장중 신호 트리거(10분마다, intraday_signal.gs)가 부를 때 30분에 한 번만 GitHub 확인
 *   · 07:00~23:00 에만 알림 (밤에는 다음 아침에)
 *   · 같은 실패는 1번만 · 다음 배포가 성공하면 다시 대기
 *   · GitHub 조회는 GH_DISPATCH_TOKEN(이미 있음)으로, 없으면 토큰 없이 (공개 저장소)
 *
 * ▶ 확인: previewDeployWatch 실행 → 로그에 최근 배포 결과 (카톡은 안 보냄)
 */

var DW_WORKFLOW = 'gas_deploy.yml';
var DW_EVERY_MIN = 30;

function previewDeployWatch() { dwCheckDeploy_(true); }

function dwCheckDeploy_(dryRun) {
  var props = PropertiesService.getScriptProperties();
  var now = new Date();
  var hm = Utilities.formatDate(now, 'Asia/Seoul', 'HHmm');
  if (!dryRun) {
    if (hm < '0700' || hm > '2300') return;
    var last = Number(props.getProperty('DW_LAST_CHECK') || 0);
    if (now.getTime() - last < DW_EVERY_MIN * 60 * 1000) return;
    props.setProperty('DW_LAST_CHECK', String(now.getTime()));
  }

  var run = dwLatestRun_(props.getProperty('GH_DISPATCH_TOKEN'));
  if (!run) { Logger.log('ℹ️ 끝난 배포 기록이 없어요'); return; }
  Logger.log('최근 배포: ' + run.conclusion + ' · ' + run.created_at + ' · ' + run.html_url);
  if (run.conclusion !== 'failure') return;
  if (props.getProperty('DW_NOTIFIED') === String(run.id)) return;
  var msg = '🚨 Apps Script 자동 배포 실패\n시트는 이전 코드로 계속 돌아요.\n' + Utilities.formatDate(new Date(run.created_at), 'Asia/Seoul', 'M/d HH:mm') +
    ' 실행 · GitHub Actions 에서 원인 확인\n' + run.html_url;
  if (dryRun) { Logger.log('[미리보기] 보낼 카톡:\n' + msg); return; }
  kakaoSendToMe_(msg);
  props.setProperty('DW_NOTIFIED', String(run.id));
}

// 가장 최근에 끝난 실행 (진행 중인 것은 건너뜀)
function dwLatestRun_(token) {
  var url = 'https://api.github.com/repos/' + PM_REPO + '/actions/workflows/' + DW_WORKFLOW + '/runs?per_page=5';
  var headers = { Accept: 'application/vnd.github+json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  var res = UrlFetchApp.fetch(url, { headers: headers, muteHttpExceptions: true });
  // 토큰에 Actions 읽기 권한이 없으면 토큰 없이 한 번 더 (공개 저장소)
  if (token && (res.getResponseCode() === 401 || res.getResponseCode() === 403)) {
    res = UrlFetchApp.fetch(url, { headers: { Accept: 'application/vnd.github+json' }, muteHttpExceptions: true });
  }
  if (res.getResponseCode() !== 200) throw new Error('GitHub 배포 기록 조회 실패 ' + res.getResponseCode());
  var runs = (JSON.parse(res.getContentText()).workflow_runs || []).filter(function (r) { return r.status === 'completed'; });
  return runs[0] || null;
}

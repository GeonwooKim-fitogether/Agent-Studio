# Windows PC 에서 PR 미리보기를 켜고 휴대전화로 여는 방법

> 한 줄 요지: **Windows PC 와 휴대전화에 Tailscale(무료 사설망 앱)을 깔고, `.env.local` 에 세 줄을 적은 뒤 Studio 를 다시 켠다.** 그러면 업무 화면의 Review 패널에서 `Open Preview` 를 누를 수 있고, 화면에 뜬 주소를 휴대전화에서 열면 그 PR 커밋의 앱이 보인다.

이 문서는 기능 기획서의 F1(Preview 실기기 확인, 단위 2-A)을 Mac Pro 대신 **Windows PC 로 먼저** 확인하기 위한 안내다(2026-09-30 사용자 결정). 미리보기 기능 자체의 설명은 [`../plan/04-remote-preview.md`](../plan/04-remote-preview.md) 에 있다. Mac Pro 로의 확인은 나중에 따로 한다.

## 먼저 알아 둘 것 — 이 PC 에서 PR 의 코드가 실행된다

미리보기는 PR 의 코드를 이 PC 에서 **사용자님의 Windows 계정 그대로** 실행한다. 그 코드는 이 계정이 읽을 수 있는 파일(예: `.env.local`, GitHub App 비밀 키 파일)을 읽을 수 있다. Studio 는 복제본(fork)에서 온 PR 은 실행하지 않지만, 같은 저장소의 브랜치라면 누가 쓴 코드든 실행한다.

그래서 **내가 믿는 사람(또는 내 Claude 세션)이 쓴 PR 만 미리보기로 연다.** 따로 격리된 계정이나 컨테이너에서 돌리는 것은 Mac Pro 단계에서 결정할 일로 남아 있다.

## 1. Tailscale 을 PC 와 휴대전화에 설치한다

Tailscale 은 내 기기끼리만 닿는 사설망을 만들어 주는 앱이다. 개인 사용은 무료다. 휴대전화가 인터넷 어디에 있든 PC 의 미리보기 주소에 닿게 해 주고, 다른 사람은 닿지 못한다.

1. PC 에서 https://tailscale.com/download/windows 를 열어 설치하고 로그인한다.
2. 휴대전화에서 앱 스토어(또는 Play 스토어)로 **Tailscale** 을 설치하고 **같은 계정**으로 로그인한다.
3. PC 의 작업 표시줄 오른쪽 Tailscale 아이콘을 누르면 이 PC 의 주소가 보인다. `100.` 으로 시작하는 네 칸 숫자다(예: `100.101.102.103`). 이 주소를 아래에서 쓴다.

성공하면: 휴대전화의 Tailscale 앱 목록에 이 PC 의 이름이 "Connected" 로 보인다.

## 2. `.env.local` 에 세 줄을 적는다

`C:\Users\rlaaj\Work\Agent-Studio\.env.local` 을 메모장으로 열어 아래 세 줄을 더한다. `100.101.102.103` 은 1-3 에서 본 주소로 바꾼다.

```
PREVIEW_WORKDIR=C:\Users\rlaaj\studio-previews
PREVIEW_BIND_HOST=100.101.102.103
PREVIEW_ALLOWED_DEV_ORIGINS=100.101.102.103
```

- `PREVIEW_WORKDIR` 는 미리보기마다 코드를 풀어 둘 빈 폴더다. 탐색기에서 `C:\Users\rlaaj\studio-previews` 폴더를 먼저 만들어 둔다. **다른 파일을 두지 않는다** — Studio 가 켜질 때 이 폴더 안의 `preview-…` 폴더를 지운다.
- `PREVIEW_BIND_HOST` 는 미리보기 앱이 받을 주소다. `0.0.0.0`(모든 주소)은 쓰지 않는다. 사설망 주소만 적어야 같은 와이파이의 다른 사람이 닿지 못한다.
- `PREVIEW_ALLOWED_DEV_ORIGINS` 는 Studio 자신도 휴대전화로 열고 싶을 때 쓴다. 없어도 미리보기는 열린다(미리보기 앱에는 실행기가 이 값을 알아서 넘긴다).

## 3. Studio 를 다시 켠다

Studio 를 켜 둔 PowerShell 창에서 `Ctrl + C` 로 멈추고, 다시 `npm run dev` 를 실행한다.

성공하면: 브라우저에서 http://localhost:3000 을 열고 사이드바 아래 `Connections` 를 누르면, 미리보기 기기가 "this computer · 100.101.102.103" 처럼 연결됨으로 보인다.

## 4. PR 하나를 업무에 붙이고 Open Preview 를 누른다

1. 사이드바의 `Inbox` 에서 Agent-Studio 저장소의 열린 PR 하나를 골라 업무에 연결한다(새 업무를 만들어도 된다). 이 저장소는 Next.js 앱이고 lockfile 이 있어 미리보기가 된다.
2. 그 업무를 열고, PR 카드의 `Open review` 를 눌러 오른쪽 Review 패널을 연 뒤 `Open Preview` 를 누른다.
3. 처음에는 코드를 받고 `npm ci` 로 설치하느라 **몇 분** 걸린다. Review 패널에 진행 상태가 보인다.
4. **Windows 방화벽 창이 뜨면 `허용`을 누른다.** 이것을 누르지 않으면 휴대전화에서 닿지 않는다.
5. 준비되면 Review 패널에 "Running · PR #n · 커밋 앞 7자리" 와 `http://100.101.102.103:<숫자>/` 주소, `Open` 링크가 보인다.

## 5. 휴대전화에서 연다

휴대전화의 Tailscale 이 켜져 있는지 보고, 브라우저에 4-5 의 주소를 그대로 입력한다.

성공하면: 휴대전화에 그 PR 커밋의 앱 화면이 뜨고, 버튼을 눌러 화면이 바뀐다. 이 확인이 끝나면 F1 을 "Windows PC 로 확인" 으로 적는다(Mac Pro 확인은 별도).

## 잘 안 될 때

| 보이는 것 | 뜻 | 할 일 |
|---|---|---|
| `Open Preview` 가 회색이고 사이드바 아래에 "Preview host offline" | `PREVIEW_WORKDIR` 가 읽히지 않았다 | `.env.local` 의 줄을 확인하고 Studio 를 다시 켠다 |
| "PREVIEW_BIND_HOST 의 주소에 포트를 열 수 없다" | 그 주소가 이 PC 의 것이 아니다 | Tailscale 이 켜져 있는지, 주소를 정확히 옮겼는지 본다 |
| "코드를 받지 못했다" | GitHub 에서 그 커밋의 코드를 받지 못했다 | GitHub App 이 그 저장소에 설치돼 있는지 본다. **이 경로는 실제 GitHub 로 처음 돌려 보는 것이라**, Review 패널의 로그 꼬리를 캡처해 보내 주면 원인을 찾는다 |
| "코드 풀기(tar)" 에서 실패 | Windows 의 `tar` 가 묶음을 풀지 못했다 | 로그 꼬리를 캡처해 보내 준다 |
| PC 에서는 열리는데 휴대전화에서 안 열린다 | 방화벽이나 Tailscale 연결 문제 | 휴대전화 Tailscale 이 Connected 인지, 4-4 의 방화벽 창에서 허용했는지 본다 |
| 휴대전화에 화면은 보이는데 버튼이 반응하지 않는다 | 개발 서버가 그 주소를 막았다 | 그 PR 에 이 문서와 같은 시기의 `next.config.ts`(`allowedDevOrigins`)가 들어 있는지 본다. 이 설정이 들어간 뒤의 커밋이어야 한다 |

## 아직 Windows 에서 돌려 본 적 없는 것

- **미리보기를 끌 때 남는 프로세스.** Windows 에서는 `taskkill /T /F` 로 끄는데, 앱을 띄운 맨 앞 프로세스가 먼저 끝나 버린 경우 그 아래 앱을 찾지 못할 수 있다(04 문서 §4). 다음 미리보기는 새 포트를 고르므로 막히지는 않지만, 작업 관리자에 `node` 가 남아 있으면 알려 준다.
- **실제 GitHub 에서 코드를 받는 경로.** 지금까지는 가짜 GitHub 응답과 로컬 저장소로만 시험했다.

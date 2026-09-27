# 조직 저장소를 읽는 토큰 만들기 — Owner 가 아니어도 된다

> 한 줄 요지: **GitHub 설정 화면에서 `fitogether-org` 조직만 읽을 수 있는 읽기 전용 fine-grained 토큰(세밀하게 권한을 고르는 개인 접근 토큰)을 하나 만들고, 그 값을 앱을 띄울 곳의 `GITHUB_TOKEN` 에만 적는다.** 브라우저만으로 3분 정도 걸린다. 결정 12 의 사람 몫이다.

## 왜 필요한가

개인 계정 저장소는 GitHub App 이 읽는다([`github-app.md`](github-app.md)). 그런데 조직(`fitogether-org`)에 App 을 설치하려면 조직 Owner 가 필요하고, 지금 사용자는 Owner 가 아니다. 그래서 조직 저장소는 **사용자 본인의 권한으로, 읽기만 하는 토큰**으로 읽는다. 이 토큰은 사용자가 이미 볼 수 있는 저장소만 읽을 수 있고, 무엇을 고치거나 합치는 권한은 없다.

토큰과 App 을 둘 다 설정하면 Studio 는 두 출처를 한 번의 Sync 에 합친다. 같은 저장소가 양쪽에 다 보이면 App 쪽으로 한 번만 읽는다.

## 1. 토큰 만들기

**어디서.** GitHub 에 로그인한 브라우저. 오른쪽 위 프로필 사진 → **Settings** → 왼쪽 메뉴 맨 아래 **Developer settings** → **Personal access tokens** → **Fine-grained tokens** → **Generate new token**.

**무엇을.** 칸을 위에서부터 이렇게 채운다.

| 칸 | 넣을 값 |
|---|---|
| Token name | `Agent Studio – fitogether-org 읽기` 처럼 나중에 알아볼 이름 |
| Resource owner | 목록에서 **`fitogether-org`** 를 고른다. 내 계정이 기본값이므로 반드시 바꾼다 — 이것이 "이 토큰은 이 조직의 저장소만 본다" 는 뜻이다 |
| Expiration | 90 days 를 권한다. 조직이 최대 기간을 정해 두었으면 그보다 길게 고를 수 없다. 최대 1년이며, 만료되면 같은 순서로 다시 만든다 |
| Repository access | **All repositories** — 조직에 새 저장소가 생겨도 다음 Sync 에 자동으로 들어온다 |

**Permissions** 에서 **Repository permissions** 를 열고(화면에 따라 **Add permissions** 를 눌러 고른다) 아래 다섯 개만 **Read-only** 로 둔다. 나머지는 고르지 않는다(No access). Organization permissions 와 Account permissions 도 고르지 않는다.

| 권한 | 값 |
|---|---|
| Checks | Read-only |
| Commit statuses | Read-only |
| Contents | Read-only |
| Metadata | Read-only (자동으로 켜지고 끌 수 없다) |
| Pull requests | Read-only |

맨 아래 **Generate token** 을 누른다. 다음 화면에 `github_pat_` 로 시작하는 토큰 값이 **한 번만** 보인다. 바로 복사해 2단계로 간다.

- **토큰 값은 채팅 · 저장소 · 메신저 · 스크린샷에 붙이지 않는다.** Claude 에게도 알려 주지 않는다. 이 값이 곧 내 계정의 읽기 권한이다.
- 잃어버렸거나 새었다고 생각되면 같은 목록에서 그 토큰을 **Delete** 하고 새로 만들면 된다.

## 2. "Pending" 이 보이면 — 조직의 승인을 기다리는 중이다

만든 뒤 Fine-grained tokens 목록에서 토큰 옆에 **Pending** 이 붙어 있을 수 있다. 조직이 "조직 자원에 접근하는 토큰은 관리자 승인을 받는다" 는 정책을 켜 둔 경우다.

- 승인 전까지 이 토큰으로는 조직의 **비공개** 저장소를 읽을 수 없다(공개 저장소는 읽힐 수 있다). Studio 화면 위쪽 띠에는 두 모습 중 하나가 보인다 — `Token (fitogether-org): 실패 — 접근이 막혔다 — 권한이 모자라거나, 조직이 이 토큰을 아직 승인하지 않았다(Pending)`, 또는 실패는 아니지만 저장소 수가 기대보다 적다(공개 저장소만 보인다). App 이 읽는 개인 저장소는 어느 경우든 그대로 읽힌다.
- 풀려면 조직 **Owner** 가 **조직 Settings → 왼쪽 메뉴 Personal access tokens → Pending requests** 에서 이 토큰을 눌러 **Approve** 해야 한다. 사용자 쪽에서 할 수 있는 일은 없다. GitHub 가 Owner 에게 승인 대기 목록을 매일 메일로 알려 주지만, "토큰 이름, 읽기 전용 다섯 권한, 만료일" 을 직접 알려 주면 판단이 빠르다.
- 조직이 fine-grained 토큰 자체를 막아 두었으면 Resource owner 목록에 조직이 보이지 않는다. 그때도 Owner 의 설정 변경이 필요하다.

## 3. 앱을 띄울 곳에 적기

**로컬.** 저장소 루트의 `.env.local` 파일(없으면 `.env.example` 을 복사해 만든다)에 두 줄을 적는다. 이 파일은 git 에 올라가지 않는다.

```
GITHUB_TOKEN=<1단계에서 복사한 토큰 값>
GITHUB_TOKEN_ORGS=fitogether-org
```

**클라우드 환경.** 그 환경의 비밀 값(환경변수) 설정 화면에 같은 두 값을 넣는다.

App 변수(`GITHUB_APP_ID` 등)가 이미 있으면 그대로 둔다. 두 출처가 함께 읽힌다. 조직 전체가 아니라 몇 개만 읽고 싶으면 `GITHUB_TOKEN_ORGS` 대신 `GITHUB_REPOS=fitogether-org/web,fitogether-org/api` 처럼 적어도 된다. 둘 다 비어 있으면 화면에 설정 오류가 뜬다.

## 성공하면 무엇이 보이나

- GitHub 의 Fine-grained tokens 목록에 토큰이 보이고, Pending 표시가 없다.
- 앱을 띄우면 화면 위쪽 띠가 **GitHub App + token (read-only)** 으로 바뀌고, 그 옆에 출처마다 한 줄씩 보인다.
  - `GitHub App: 저장소 N · PR M`
  - `Token (fitogether-org): 저장소 N · PR M`
- Sync 를 누르면 조직 저장소마다 프로젝트가 생기고, 그 PR 이 업무와 Inbox 에 나타난다.

## 하지 않으면 무엇이 걸리나

Agent Studio 는 개인 계정 저장소만 읽는다. 팀의 실제 작업이 있는 `fitogether-org` 저장소의 PR 이 Workspace 에 나타나지 않아, 1단계의 성공 기준(저장소 5개 이상의 PR 을 혼동 없이 보기)을 팀 저장소로 확인할 수 없다.

## 실패했을 때 띠에 보이는 것

| 띠의 문장 | 뜻 | 할 일 |
|---|---|---|
| `실패 — 인증이 거절됐다 — 토큰이 만료됐거나 취소됐다` | 토큰이 만료됐거나 지워졌다 | 1단계부터 새로 만들어 `GITHUB_TOKEN` 을 바꾼다 |
| `실패 — 접근이 막혔다 — … 아직 승인하지 않았다(Pending)` | 조직 승인 대기, 또는 권한이 모자란다 | 2단계. 권한 다섯 개가 Read-only 인지도 확인한다 |
| 실패는 아닌데 `Token (fitogether-org): 저장소` 수가 기대보다 적다 | 승인 대기라 공개 저장소만 보이거나, Repository access 가 All repositories 가 아니다 | 목록의 Pending 표시와 Repository access 를 확인한다 |
| 설정 오류 `GITHUB_TOKEN 은 있는데 읽을 곳이 없다` | 조직 이름도 저장소 목록도 없다 | `GITHUB_TOKEN_ORGS=fitogether-org` 를 적는다 |

한 출처가 실패해도 다른 출처의 결과는 그대로 받아 적는다.

## 참고한 GitHub 문서

- [Managing your personal access tokens](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens)
- [Managing requests for personal access tokens in your organization](https://docs.github.com/en/organizations/managing-programmatic-access-to-your-organization/managing-requests-for-personal-access-tokens-in-your-organization) — 승인은 조직 Owner 가 하고, 승인 전 토큰은 공개가 아닌 자원에 닿지 못한다.

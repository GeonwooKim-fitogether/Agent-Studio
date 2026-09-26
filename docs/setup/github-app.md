# GitHub App 만들기 — Agent Studio 가 저장소를 읽게 하는 설정

> 한 줄 요지: **GitHub 설정 화면에서 읽기 권한만 있는 App 을 하나 만들고, 읽을 저장소에 설치한 뒤, 숫자 두 개와 비밀 키 파일 하나를 앱을 띄울 컴퓨터에 둔다.** 브라우저만으로 5분 정도 걸린다. 결정 11 의 사람 몫이다.

## 왜 필요한가

Agent Studio 는 지금 고정 시연 데이터로만 돈다. 이 App 이 있어야 실제 저장소의 PR 을 읽어 업무에 모을 수 있고, 1단계의 성공 기준(저장소 5개 이상의 PR 을 혼동 없이 보기)을 실제 데이터로 확인할 수 있다. App 은 **읽기만** 한다. 브랜치를 만들거나 PR 을 합치는 권한은 주지 않는다.

## 1. App 만들기

1. GitHub 에 로그인한 브라우저에서 오른쪽 위 프로필 사진을 누르고 **Settings** 로 간다.
2. 왼쪽 메뉴 맨 아래 **Developer settings** 를 누르고, **GitHub Apps** 에서 **New GitHub App** 을 누른다.
3. 칸을 이렇게 채운다.

   | 칸 | 넣을 값 |
   |---|---|
   | GitHub App name | `Agent Studio 건우` 처럼 GitHub 전체에서 겹치지 않는 이름 |
   | Homepage URL | `https://github.com/GeonwooKim-fitogether/Agent-Studio` |
   | Webhook → Active | **체크를 끈다** (지금은 공개 주소가 없다) |
   | Where can this GitHub App be installed? | **Only on this account** |

4. **Repository permissions** 에서 아래 다섯 개만 **Read-only** 로 바꾸고, 나머지는 모두 **No access** 로 둔다.

   | 권한 | 값 |
   |---|---|
   | Checks | Read-only |
   | Commit statuses | Read-only |
   | Contents | Read-only |
   | Metadata | Read-only (자동으로 켜진다) |
   | Pull requests | Read-only |

   Organization permissions 와 Account permissions 는 모두 No access 로 둔다.

5. 맨 아래 **Create GitHub App** 을 누른다. 다음 화면 위쪽의 **App ID** 숫자를 적어 둔다.

## 2. 비밀 키 받기

1. 같은 화면을 아래로 내려 **Private keys** 에서 **Generate a private key** 를 누른다.
2. `.pem` 으로 끝나는 파일이 내려받아진다. 이 파일이 App 의 비밀번호다.
   - **채팅 · 저장소 · 메신저에 붙여 넣지 않는다.** 앱을 띄울 컴퓨터의 안전한 폴더에만 둔다.
   - 잃어버리거나 새었다고 생각되면 같은 자리에서 그 키를 지우고 새로 만들면 된다.

## 3. 저장소에 설치하기

1. 왼쪽 메뉴 **Install App** 을 누르고, 내 계정 옆의 **Install** 을 누른다.
2. **Only select repositories** 를 고르고, Agent Studio 가 읽을 저장소를 고른다. 1단계 확인에는 **5개 이상**이 좋다.
3. **Install** 을 누른다. 이동한 화면의 주소가 `https://github.com/settings/installations/12345678` 처럼 끝나는데, 마지막 숫자가 **설치 ID** 다.

조직(예: `fitogether-org`) 소유 저장소에 App 을 설치하려면 조직 Owner 가 필요하다. Owner 가 아니면 조직 저장소는 App 대신 내 읽기 전용 토큰으로 읽는다(결정 12) — [`org-token.md`](org-token.md).

## 이 저장소의 실제 값 (비밀 아님)

2026-09-26 에 만든 App 의 값이다. 비밀 키는 여기 적지 않는다.

| 값 | |
|---|---|
| App 이름 | Agent Studio GeonwooKim |
| App ID | 5089642 |
| 설치 ID | 165265737 (개인 계정, All repositories) |

## 4. 앱을 띄울 곳에 적기

숫자 두 개는 어디서나 같다. 비밀 키는 **앱을 띄우는 곳에 따라 두 방식 중 하나만** 쓴다. 둘 다 적으면 어느 것을 쓸지 모호해 화면에 설정 오류가 뜬다.

| 앱을 띄우는 곳 | 비밀 키를 주는 방식 | 변수 |
|---|---|---|
| 내 컴퓨터(로컬) | `.pem` **파일의 경로** | `GITHUB_APP_PRIVATE_KEY_PATH` |
| 파일을 둘 수 없는 클라우드 환경(claude.ai 의 클라우드 환경 설정 등) | `.pem` 파일의 **내용 전체** | `GITHUB_APP_PRIVATE_KEY` |

**로컬.** 저장소 루트의 `.env.local` 파일(없으면 `.env.example` 을 복사해 만든다)에 세 줄을 적는다. 이 파일은 git 에 올라가지 않는다.

```
GITHUB_APP_ID=<1단계의 App ID>
GITHUB_APP_INSTALLATION_ID=<3단계의 설치 ID>
GITHUB_APP_PRIVATE_KEY_PATH=<2단계의 .pem 파일 경로>
```

**클라우드 환경.** 그 환경의 비밀 값(환경변수) 설정 화면에 세 값을 넣는다. `GITHUB_APP_PRIVATE_KEY` 에는 `.pem` 파일을 텍스트 편집기로 열어 `-----BEGIN` 줄부터 `-----END` 줄까지 **전부** 복사해 붙여 넣는다.

- 칸이 여러 줄을 받으면 그대로 붙여 넣는다.
- 칸이 한 줄만 받으면 그냥 붙여 넣어도 된다. 칸이 줄바꿈을 공백으로 바꾸거나 지워 버려도, 줄바꿈을 `\n` 두 글자로 바꾼 한 줄이어도, 파일 내용을 base64 로 바꾼 한 줄이어도 Studio 가 모두 같은 키로 읽는다. `-----BEGIN` 머리와 `-----END` 꼬리 사이의 본문을 다시 조립하기 때문이다. 붙여 넣을 때 생긴 앞뒤 공백과 줄끝 문자도 정리한다.
- 형식이 틀리면 화면에 "GITHUB_APP_PRIVATE_KEY 의 형식을 읽지 못했다" 는 안내만 보인다. 키의 내용 · 길이 · 앞부분은 화면과 기록 어디에도 나오지 않는다.

## 성공하면 무엇이 보이나

- App 설정 화면의 Permissions 에 위 다섯 개가 Read-only 로, 나머지가 No access 로 보인다.
- 설치 화면에 고른 저장소 목록이 보인다.
- 앱을 띄우면 화면 위쪽 띠가 "Fixture data" 대신 "GitHub App" 으로 바뀌고, Sync 를 누르면 고른 저장소의 PR 이 업무와 Inbox 에 나타난다.

## 하지 않으면 무엇이 걸리나

Agent Studio 는 계속 시연 데이터로만 돈다. 1단계의 성공 기준을 실제 데이터로 확인할 수 없고, 2단계(Mac Pro 미리보기)는 실행할 진짜 PR 이 없어 검증 대상이 없다.

## Claude 에게 알려 줄 것

App ID 와 설치 ID 두 숫자는 채팅으로 알려 줘도 된다. 비밀 키는 알려 주지 않는다. Claude 가 클라우드 환경에서도 실데이터로 확인하려면, claude.ai 의 클라우드 환경 설정에서 비밀 값으로 넣는 방법이 따로 있다. 그 방법이 필요하면 그때 안내한다.

## 조직 저장소도 함께 읽으려면

App 은 개인 계정 저장소를 읽는다. 조직(`fitogether-org`) 저장소는 내 읽기 전용 토큰으로 함께 읽는다 — 만드는 순서는 [`org-token.md`](org-token.md) 에 있다. 두 값을 모두 적으면 Studio 가 두 출처를 한 번의 Sync 에 합친다.

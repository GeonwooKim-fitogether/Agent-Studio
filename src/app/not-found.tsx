import Link from "next/link";

/** 없는 업무 주소나 없는 화면. 저장이 서버 메모리라 서버를 다시 켜면 새로 만든 업무가 사라질 수 있다. */
export default function NotFound() {
  return (
    <div className="page-inner">
      <div className="page-head">
        <h1>찾는 업무나 화면이 없다</h1>
        <p className="muted">
          주소가 잘못됐을 수 있다. 저장이 서버 메모리일 때는 서버를 다시 켜면 새로 만든 업무가 사라진다.
        </p>
      </div>
      <Link href="/" className="btn primary">
        Back to Workspace
      </Link>
    </div>
  );
}

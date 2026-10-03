// 워크스페이스 세팅 확인용: Node가 .ts를 그대로 실행하고 .env가 로드되는지 보여준다.
const databaseUrl: string | undefined = process.env.DATABASE_URL;

console.log(`ontology up on node ${process.version}`);
console.log(`DATABASE_URL ${databaseUrl ? "loaded" : "missing"}`);

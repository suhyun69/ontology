const databaseUrl: string | undefined = process.env.DATABASE_URL;

console.log(`ontology up on node ${process.version}`);
console.log(`DATABASE_URL ${databaseUrl ? "loaded" : "missing"}`);

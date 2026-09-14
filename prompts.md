set up a pnpm workspace project for a "run ts directly" worklow. Add a tsconfig.base.json with settings turned for a "Node 26 runs TS natively" worklow and .gitignore One workspace: apps/ontology/ with its own package.json and tsconfig.json extending the base. Initialize a git repo.

install pg at the workspace root

Create a CLi script run-sql.ts at the repo root taking the path to a .sql file, connects via pg using DATABASE_URL, executes it, and reports the result. Add it as run-sql script to the root package.json, invoking via node --env-file=__.
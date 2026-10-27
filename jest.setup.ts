import * as dotenv from "dotenv";
import {join} from "path";

// The real-provider tests read their API keys from the repo-root .env (see .env.sample), whichever package runs them
dotenv.config({path: join(__dirname, ".env")});
jest.setTimeout(60000);

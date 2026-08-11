import { main } from "./cli";
import { message } from "./utils";

export { main };

if (require.main === module) {
  main(process.argv).catch((err) => {
    console.error(`[错误] ${message(err)}`);
    process.exitCode = 1;
  });
}

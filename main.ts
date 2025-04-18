import promptSync from "prompt-sync";
import { createKeypairs } from "./src/create-keys";
import { sender } from "./src/sender-ui";
import { buyBundle } from "./src/jito-pool";
import { sellXPercentagePF } from "./src/sellFunc";

const prompt = promptSync();

async function main() {
  let r = true;

  while (r) {
    console.log("DM me for support");
    console.log("https://t.me/oiia99x");
    console.log("\nMenu:");
    console.log("1. Create Keypairs");
    console.log("2. Pre Launch Checklist");
    console.log("3. Create Pool Bundle");
    console.log("4. Sell % of Supply on Pump.Fun");
    console.log("Type 'exit' to quit.");

    const answer = prompt("Choose an option or 'exit': ");

    switch (answer) {
      case "1":
        await createKeypairs();
        break;
      case "2":
        sender();
        break;
      case "3":
        buyBundle();
        break;
      case "4":
        sellXPercentagePF();
        break;
      case "exit":
        r = false;
        break;
      default:
        console.log("Invalid option, please choose again.");
    }
  }

  console.log("Exiting...");
  process.exit(0);
}

main().catch((err) => {
  console.error("Error:", err);
});

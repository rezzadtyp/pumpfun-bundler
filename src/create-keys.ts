import { Keypair } from "@solana/web3.js";
import * as fs from "fs";
import path from "path";
import bs58 from "bs58";
import PromptSync from "prompt-sync";

const prompt = PromptSync();

const keypairsDir = path.join(__dirname, "keypairs");
const keyInfoPath = path.join(__dirname, "keyInfo.json");

interface IPoolInfo {
  [key: string]: any;
  numOfWallets?: number;
}

if (!fs.existsSync(keypairsDir)) {
  fs.mkdirSync(keypairsDir, { recursive: true });
}

function generateWallets(numOfWallets: number): Keypair[] {
  let wallets: Keypair[] = [];
  for (let i = 0; i < numOfWallets; i++) {
    const wallet = Keypair.generate();
    wallets.push(wallet);
  }
  return wallets;
}

function saveKeypairToFile(keypair: Keypair, index: number) {
  const keypairPath = path.join(keypairsDir, `keypair${index + 1}.json`);
}

function readKeypairs(): Keypair[] {
  const files = fs.readdirSync(keypairsDir);
  return files.map((file) => {
    const filePath = path.join(keypairsDir, file);
    const secretKey = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    return Keypair.fromSecretKey(new Uint8Array(secretKey));
  });
}

function updatePoolInfo(wallets: Keypair[]) {
  let poolInfo: IPoolInfo = {};

  if (fs.existsSync(keyInfoPath)) {
    const data = fs.readFileSync(keyInfoPath, "utf-8");
    poolInfo = JSON.parse(data);
  }

  poolInfo.numOfWallets = wallets.length;
  wallets.forEach((w, index) => {
    poolInfo[`pubkey${index + 1}`] = w.publicKey.toString();
  });

  fs.writeFileSync(keyInfoPath, JSON.stringify(poolInfo, null, 2));
}

export async function createKeypairs() {
  console.log(
    "WARNING: If you create new ones, ensure you don't have SOL, OR ELSE IT WILL BE GONE."
  );
  const action = prompt(
    "Do you want to (c)reate new wallets or (u)se existing ones? (c/u): "
  );
  let wallets: Keypair[] = [];

  if (action === "c") {
    const numOfWallets = 24;
    if (isNaN(numOfWallets) || numOfWallets <= 0) {
      console.log("Invalid number. Please enter a positive integer.");
      return;
    }

    wallets = generateWallets(numOfWallets);
    wallets.forEach((w, i) => {
      saveKeypairToFile(w, i);
      console.log(`Wallet ${i + 1} Public Key: ${w.publicKey.toString()}`);
    });
  } else if (action === "u") {
    wallets = readKeypairs();
    wallets.forEach((w, i) => {
      console.log(`Read wallet ${i + 1} Public Key: ${w.publicKey.toString()}`);
      console.log(
        `Read Wallet ${i + 1} Private Key: ${bs58.encode(w.secretKey)}\n`
      );
    });
  } else {
    console.log(
      'Invalid option. Please enter "c" for create or "u" for use existing.'
    );
    return;
  }

  updatePoolInfo(wallets);
  console.log(`${wallets.length} wallets have been processed.`);
}

export function loadKeypairs(): Keypair[] {
  const keypairRegex = /^keypair\d+\.json$/;

  return fs
    .readdirSync(keypairsDir)
    .filter((file) => keypairRegex.test(file))
    .map((file) => {
      const filePath = path.join(keypairsDir, file);
      const secretKeyString = fs.readFileSync(filePath, { encoding: "utf-8" });
      const secretKey = Uint8Array.from(JSON.parse(secretKeyString));
      return Keypair.fromSecretKey(secretKey);
    });
}

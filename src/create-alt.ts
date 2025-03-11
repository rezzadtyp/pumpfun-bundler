import promptSync from "prompt-sync";
import path from "path";
import fs from "fs";
import { Program, Idl, AnchorProvider, setProvider } from "@coral-xyz/anchor";
import { connection, payer, PUMP_PROGRAM, wallet } from "../config";
import idl from "../pumpfun-IDL.json";
import {
  AddressLookupTableAccount,
  AddressLookupTableProgram,
  Blockhash,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { bs58 } from "@coral-xyz/anchor/dist/cjs/utils/bytes";
import * as spl from "@solana/spl-token";
import { loadKeypairs } from "./create-keys";
import { getRandomTipAccount } from "./clients/config";
import { searcherClient } from "./clients/jito";
import { Bundle as JitoBundle } from "jito-ts/dist/sdk/block-engine/types.js";
import { lookupTableProvider } from "./clients/lookup-table-provider";

const prompt = promptSync();
const keyInfoPath = path.join(__dirname, "keyInfo.json");

const provider = new AnchorProvider(connection, wallet as any, {});

setProvider(provider);

const program = new Program(idl as Idl, PUMP_PROGRAM);

export async function extendALT() {
  // -------- step 1: ask nessesary questions for ALT build --------
  let vanityPK = null;

  const vanityPrompt = prompt(
    "Do you want to import a custom vanity address? (y/n)"
  ).toLowerCase();
  const jitoTipAmount =
    +prompt("Jito tip in Sol (ex. 0.01): ") * LAMPORTS_PER_SOL;
  if (vanityPrompt === "y") {
    vanityPK = prompt(
      "Enter the private key of the vanity address (bs58 / phantom wallet format): "
    );
  }

  // read existing data from poolInfo.json
  let poolInfo: { [key: string]: any } = {};
  if (fs.existsSync(keyInfoPath)) {
    const data = fs.readFileSync(keyInfoPath, "utf-8");
    poolInfo = JSON.parse(data);
  }

  const bundledTxns1: VersionedTransaction[] = [];

  // -------- step 2: get all ALT addresses --------
  const accounts: PublicKey[] = [];
  const alt = new PublicKey(poolInfo.addressALT.toString());

  const lookupTableAccount = (await connection.getAddressLookupTable(alt))
    .value;

  if (lookupTableAccount == null) {
    console.log("Lookup table account not found!");
    process.exit(0);
  }

  let mintKp;

  if (vanityPK === null) {
    mintKp = Keypair.generate();
  } else {
    mintKp = Keypair.fromSecretKey(bs58.decode(vanityPK));
  }

  console.log(`Mint: ${mintKp.publicKey.toString()}`);
  poolInfo.mint = mintKp.publicKey.toString();
  poolInfo.mintPk = bs58.encode(mintKp.secretKey);
  fs.writeFileSync(keyInfoPath, JSON.stringify(poolInfo, null, 2));

  // fetch accounts for ALT
  const mintAuthority = new PublicKey(
    "TSLvdd1pWpHVjahSpsvCXUbgwsL3JAcvokwaKt1eokM"
  );
  const MPL_TOKEN_METADATA_PROGRAM_ID = new PublicKey(
    "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s"
  );
  const global = new PublicKey("4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf");
  const [bondingCurve] = PublicKey.findProgramAddressSync(
    [Buffer.from("bonding-curve"), mintKp.publicKey.toBytes()],
    program.programId
  );
  const [metadata] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("metadata"),
      MPL_TOKEN_METADATA_PROGRAM_ID.toBytes(),
      mintKp.publicKey.toBytes(),
    ],
    MPL_TOKEN_METADATA_PROGRAM_ID
  );
  let [associatedBondingCurve] = PublicKey.findProgramAddressSync(
    [
      bondingCurve.toBytes(),
      spl.TOKEN_PROGRAM_ID.toBytes(),
      mintKp.publicKey.toBytes(),
    ],
    spl.ASSOCIATED_TOKEN_PROGRAM_ID
  );
  const eventAuthority = new PublicKey(
    "Ce6TQqeHC9p8KetsN6JsjHK7UTZk7nasjjnr7XxXp9F1"
  );
  const feeRecipient = new PublicKey(
    "CebN5WGQ4jvEPvsVU4EoHEpgzq1VV7AbicfhtW4xC9iM"
  );

  accounts.push(
    spl.ASSOCIATED_TOKEN_PROGRAM_ID,
    spl.TOKEN_PROGRAM_ID,
    MPL_TOKEN_METADATA_PROGRAM_ID,
    mintAuthority,
    global,
    program.programId,
    PUMP_PROGRAM,
    metadata,
    associatedBondingCurve,
    bondingCurve,
    eventAuthority,
    SystemProgram.programId,
    SYSVAR_RENT_PUBKEY,
    mintKp.publicKey,
    feeRecipient
  );

  // Loop through each keypair and push its pubkey and ATAs to the accounts array
  const keypairs = loadKeypairs();
  for (const keypair of keypairs) {
    const ataToken = await spl.getAssociatedTokenAddress(
      mintKp.publicKey,
      keypair.publicKey
    );
    accounts.push(keypair.publicKey, ataToken);
  }

  const ataTokenwall = await spl.getAssociatedTokenAddress(
    mintKp.publicKey,
    wallet.publicKey
  );

  const ataTokenpayer = await spl.getAssociatedTokenAddress(
    mintKp.publicKey,
    payer.publicKey
  );

  accounts.push(
    wallet.publicKey,
    payer.publicKey,
    ataTokenwall,
    ataTokenpayer,
    alt,
    spl.NATIVE_MINT
  );

  // -------- step 5: push ALT addresses to a txn --------
  const extendALTixs1: TransactionInstruction[] = [];
  const extendALTixs2: TransactionInstruction[] = [];
  const extendALTixs3: TransactionInstruction[] = [];
  const extendALTixs4: TransactionInstruction[] = [];

  // chunk accounts array into groups of 30
  const accountChunks = Array.from(
    { length: Math.ceil(accounts.length / 30) },
    (v, i) => accounts.slice(i * 30, (i + 1) * 30)
  );
  console.log("Num of chunks:", accountChunks.length);
  console.log("Num of accounts:", accounts.length);

  for (let i = 0; i < accountChunks.length; i++) {
    const chunk = accountChunks[i];
    const extendInstruction = AddressLookupTableProgram.extendLookupTable({
      lookupTable: alt,
      authority: payer.publicKey,
      payer: payer.publicKey,
      addresses: chunk,
    });
    if (i == 0) {
      extendALTixs1.push(extendInstruction);
      console.log("Chunk:", i);
    } else if (i == 1) {
      extendALTixs2.push(extendInstruction);
      console.log("Chunk:", i);
    } else if (i == 2) {
      extendALTixs3.push(extendInstruction);
      console.log("Chunk:", i);
    } else if (i == 3) {
      extendALTixs4.push(extendInstruction);
      console.log("Chunk:", i);
    }
  }

  // Add the jito tip to the last txn
  extendALTixs4.push(
    SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: getRandomTipAccount(),
      lamports: BigInt(jitoTipAmount),
    })
  );

  // -------- step 6: seperate into 2 different bundles to complete all txns --------
  const { blockhash: block1 } = await connection.getLatestBlockhash();

  const extend1 = await buildTxn(extendALTixs1, block1, lookupTableAccount);
  const extend2 = await buildTxn(extendALTixs2, block1, lookupTableAccount);
  const extend3 = await buildTxn(extendALTixs3, block1, lookupTableAccount);
  const extend4 = await buildTxn(extendALTixs4, block1, lookupTableAccount);

  bundledTxns1.push(extend1, extend2, extend3, extend4);

  // -------- step 7: send bundle --------
  await sendBundle(bundledTxns1);
}

export async function createALT() {
  // -------- step 1: ask nessesary questions for ALT build --------
  const jitoTipAmt = +prompt("Jito tip in Sol (Ex. 0.01): ") * LAMPORTS_PER_SOL;

  // Read existing data from poolInfo.json
  let poolInfo: { [key: string]: any } = {};
  if (fs.existsSync(keyInfoPath)) {
    const data = fs.readFileSync(keyInfoPath, "utf-8");
    poolInfo = JSON.parse(data);
  }

  const bundledTxns: VersionedTransaction[] = [];

  // -------- step 2: create a new ALT every time there is a new launch --------
  const createALTixs: TransactionInstruction[] = [];

  const [create, alt] = AddressLookupTableProgram.createLookupTable({
    authority: payer.publicKey,
    payer: payer.publicKey,
    recentSlot: await connection.getSlot("finalized"),
  });

  createALTixs.push(
    create,
    SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: getRandomTipAccount(),
      lamports: jitoTipAmt,
    })
  );

  const addressesMain: PublicKey[] = [];
  createALTixs.forEach((ixn) => {
    ixn.keys.forEach((key) => addressesMain.push(key.pubkey));
  });

  const lookupTablesMain1 =
    lookupTableProvider.computeIdealLookupTablesForAddresses(addressesMain);

  const { blockhash } = await connection.getLatestBlockhash();

  const messageMain1 = new TransactionMessage({
    payerKey: payer.publicKey,
    recentBlockhash: blockhash,
    instructions: createALTixs,
  }).compileToV0Message(lookupTablesMain1);
  const createALT = new VersionedTransaction(messageMain1);

  poolInfo.addressALT = alt.toString();

  try {
    const serializedMsg = createALT.serialize();
    console.log("Txn size:", serializedMsg.length);
    if (serializedMsg.length > 1232) {
      console.log("tx too big");
    }
    createALT.sign([payer]);
  } catch (error) {
    console.log(error, "error signing createLUT");
    process.exit(0);
  }

  // Write updated content back to poolInfo.json
  fs.writeFileSync(keyInfoPath, JSON.stringify(poolInfo, null, 2));

  // Push to bundle
  bundledTxns.push(createALT);

  // -------- step 3: SEND BUNDLE --------
  await sendBundle(bundledTxns);
}

async function buildTxn(
  extendLUTixs: TransactionInstruction[],
  blockhash: string | Blockhash,
  lut: AddressLookupTableAccount
): Promise<VersionedTransaction> {
  const messageMain = new TransactionMessage({
    payerKey: payer.publicKey,
    recentBlockhash: blockhash,
    instructions: extendLUTixs,
  }).compileToV0Message([lut]);
  const txn = new VersionedTransaction(messageMain);

  try {
    const serializedMsg = txn.serialize();
    console.log("Txn size:", serializedMsg.length);
    if (serializedMsg.length > 1232) {
      console.log("tx too big");
    }
    txn.sign([payer]);
  } catch (e) {
    const serializedMsg = txn.serialize();
    console.log("txn size:", serializedMsg.length);
    console.log(e, "error signing extendLUT");
    process.exit(0);
  }
  return txn;
}

async function sendBundle(bundledTxns: VersionedTransaction[]) {
  try {
    const bundleId = await searcherClient.sendBundle(
      new JitoBundle(bundledTxns, bundledTxns.length)
    );
    console.log(`Bundle ${bundleId} sent.`);
  } catch (error) {
    const err = error as any;
    console.error("Error sending bundle:", err.message);

    if (err?.message?.includes("Bundle Dropped, no connected leader up soon")) {
      console.error(
        "Error sending bundle: Bundle Dropped, no connected leader up soon."
      );
    } else {
      console.error("An unexpected error occurred:", err.message);
    }
  }
}

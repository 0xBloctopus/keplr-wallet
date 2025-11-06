// Shim ------------
require("setimmediate");
// Shim ------------
if (typeof importScripts !== "undefined") {
  importScripts("browser-polyfill.js");
}

import { BACKGROUND_PORT } from "@keplr-wallet/router";
import {
  ExtensionRouter,
  ExtensionGuards,
  ExtensionEnv,
  ContentScriptMessageRequester,
  InExtensionMessageRequester,
} from "@keplr-wallet/router-extension";
import { ExtensionKVStore, isServiceWorker } from "@keplr-wallet/common";
import { init } from "@keplr-wallet/background";
import type { VaultService } from "@keplr-wallet/background";
import testWalletConfig from "../../test-wallet.config.json";
import scrypt from "scrypt-js";
import { Buffer } from "buffer/";
import { Bech32Address } from "@keplr-wallet/cosmos";

import {
  CommunityChainInfoRepo,
  EmbedChainInfos,
  MsgPrivilegedContractMap,
  PrivilegedOrigins,
  TokenContractListURL,
} from "../config";

const router = new ExtensionRouter(ExtensionEnv.produceEnv);
router.addGuard(ExtensionGuards.checkOriginIsValid);
router.addGuard(ExtensionGuards.checkMessageIsInternal);

const { initFn, keyRingService, analyticsService } = init(
  router,
  (prefix: string) => new ExtensionKVStore(prefix),
  new ContentScriptMessageRequester(),
  new InExtensionMessageRequester(),
  EmbedChainInfos,
  PrivilegedOrigins,
  PrivilegedOrigins,
  PrivilegedOrigins,
  MsgPrivilegedContractMap,
  ["https://testnet.keplr.app", "https://multisig.keplr.app"],
  CommunityChainInfoRepo,
  {
    create: (params: {
      iconRelativeUrl?: string;
      title: string;
      message: string;
    }) => {
      browser.notifications.create({
        type: "basic",
        iconUrl: params.iconRelativeUrl
          ? browser.runtime.getURL(params.iconRelativeUrl)
          : undefined,
        title: params.title,
        message: params.message,
      });
    },
  },
  (callback: () => void) => {
    browser.idle.onStateChanged.addListener(
      (newState: browser.idle.IdleState) => {
        if ((newState as any) === "locked") {
          callback();
        }
      }
    );
  },
  "https://blocklist.keplr.app",
  {
    commonCrypto: {
      scrypt: async (
        text: string,
        params: { dklen: number; salt: string; n: number; r: number; p: number }
      ) => {
        return await scrypt.scrypt(
          Buffer.from(text),
          Buffer.from(params.salt, "hex"),
          params.n,
          params.r,
          params.p,
          params.dklen
        );
      },
    },
    getDisabledChainIdentifiers: async () => {
      const kvStore = new ExtensionKVStore("store_chain_config");
      const legacy = await kvStore.get<{ disabledChains: string[] }>(
        "extension_chainInfoInUIConfig"
      );
      if (!legacy) {
        return [];
      }
      return legacy.disabledChains ?? [];
    },
  },
  {
    platform: "extension",
    mobileOS: "nono",
  },
  false,
  TokenContractListURL,
  async (chainsService, lastEmbedChainInfos) => {
    try {
      if (lastEmbedChainInfos.find((c) => c.chainId === "evmos_9001-2")) {
        await chainsService.addSuggestedChainInfo({
          rpc: "https://rpc-evmos.keplr.app",
          rest: "https://lcd-evmos.keplr.app",
          evm: {
            chainId: 9001,
            rpc: "https://evm-evmos.keplr.app",
          },
          chainId: "evmos_9001-2",
          chainName: "Evmos",
          stakeCurrency: {
            coinDenom: "EVMOS",
            coinMinimalDenom: "aevmos",
            coinDecimals: 18,
            coinGeckoId: "evmos",
          },
          bip44: {
            coinType: 60,
          },
          bech32Config: Bech32Address.defaultBech32Config("evmos"),
          currencies: [
            {
              coinDenom: "EVMOS",
              coinMinimalDenom: "aevmos",
              coinDecimals: 18,
              coinGeckoId: "evmos",
            },
          ],
          feeCurrencies: [
            {
              coinDenom: "EVMOS",
              coinMinimalDenom: "aevmos",
              coinDecimals: 18,
              coinGeckoId: "evmos",
              gasPriceStep: {
                low: 25000000000,
                average: 25000000000,
                high: 40000000000,
              },
            },
          ],
          features: [
            "ibc-transfer",
            "ibc-go",
            "eth-address-gen",
            "eth-key-sign",
          ],
        });
      }
    } catch (e) {
      console.log(e);
    }
  },
  async (vaultService) => {
    if (isServiceWorker()) {
      await vaultService.unlockWithSessionPasswordIfPossible();
    }

    await ensureTestWalletPreloaded(vaultService);
  }
);

const parseBip44Component = (value: string | undefined, fallback: number) => {
  if (!value) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
};

type TestWalletConfig = {
  mnemonic?: string;
  password?: string;
  accountName?: string;
  bip44?: {
    account?: number;
    change?: number;
    addressIndex?: number;
  };
};

const ensureTestWalletPreloaded = async (
  vaultService: VaultService
): Promise<void> => {
  const env: Record<string, string | undefined> =
    typeof process !== "undefined" && process?.env
      ? (process.env as Record<string, string | undefined>)
      : {};
  const config: TestWalletConfig = (testWalletConfig ?? {}) as TestWalletConfig;

  const mnemonic = (
    env["KEPLR_TEST_MNEMONIC"] ?? config.mnemonic ?? ""
  ).trim();
  if (!mnemonic) {
    return;
  }

  const passwordRaw = env["KEPLR_TEST_PASSWORD"] ?? config.password ?? "";
  const password = passwordRaw.trim() || "testpassword";
  const accountName =
    (env["KEPLR_TEST_ACCOUNT_NAME"] ?? config.accountName ?? "Test Wallet")
      .trim() ||
    "Test Wallet";

  const bip44 = {
    account: parseBip44Component(
      env["KEPLR_TEST_BIP44_ACCOUNT"] ?? config.bip44?.account?.toString(),
      config.bip44?.account ?? 0
    ),
    change: parseBip44Component(
      env["KEPLR_TEST_BIP44_CHANGE"] ?? config.bip44?.change?.toString(),
      config.bip44?.change ?? 0
    ),
    addressIndex: parseBip44Component(
      env["KEPLR_TEST_BIP44_ADDRESS_INDEX"] ??
        config.bip44?.addressIndex?.toString(),
      config.bip44?.addressIndex ?? 0
    ),
  };

  const hasAnyVault = keyRingService.getKeyRingVaults().length > 0;

  if (!hasAnyVault) {
    try {
      await keyRingService.createMnemonicKeyRing(
        mnemonic,
        bip44,
        accountName,
        password,
        { __auto_created: true }
      );
    } catch (e) {
      console.error("Failed to auto-create Keplr test wallet", e);
      return;
    }
  }

  if (vaultService.isLocked) {
    try {
      await vaultService.unlock(password);
    } catch (e) {
      if (!(e instanceof Error) || e.message !== "Vault is already unlocked") {
        console.warn("Failed to unlock Keplr test wallet", e);
      }
    }
  }
};

router.listen(BACKGROUND_PORT, initFn).then(() => {
  // Open register popup on installed
  const kvStore = new ExtensionKVStore("__background_open_register_once");
  // "register_opened" state ensures that the register popup is opened only once.
  kvStore.get("register_opened").then((v) => {
    if (!v) {
      kvStore.set("register_opened", true);

      // We should open popup only if the keyring is empty.
      // (If user already registered, and extension is updated, this case can be happened.)
      // With waiting router is initialized, it ensures that background service is initialized.
      if (keyRingService.keyRingStatus === "empty") {
        browser.tabs.create({
          url: "/register.html#",
        });
      }
    }
  });

  kvStore.get("installed_analytics").then((v) => {
    if (!v) {
      kvStore.set("installed_analytics", true);

      analyticsService.logEvent("installed", {
        version: browser.runtime.getManifest().version,
      });
    }
  });
});

browser.alarms.create("keep-alive-alarm", {
  periodInMinutes: 0.25,
});

browser.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "keep-alive-alarm") {
    // noop
    // To make background persistent even if it is service worker, invoke noop alarm periodically.
    // https://developer.chrome.com/blog/longer-esw-lifetimes/
  }
});

// When using Chrome, a content script with world: "MAIN" is used to inject the injected script.
if (typeof chrome !== "undefined") {
  (async () => {
    try {
      await chrome.scripting.registerContentScripts([
        {
          id: "injectedScript",
          matches: ["<all_urls>"],
          js: ["injectedScript.bundle.js"],
          runAt: "document_start",
          world: "MAIN",
          allFrames: true,
        },
      ]);
    } catch (err) {
      console.warn(
        `Dropped attempt to register injected script script. ${err}`
      );
    }
  })();
}

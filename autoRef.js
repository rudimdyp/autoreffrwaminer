import axios from 'axios';
import chalk from 'chalk';
import CFonts from 'cfonts';
import fs from 'fs';
import { ethers } from 'ethers';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { SocksProxyAgent } from 'socks-proxy-agent';
import inquirer from 'inquirer';
import { v4 as uuidv4 } from 'uuid';
import https from 'https';

// Display Banner
CFonts.say('Airdrop 888', {
    font: 'block',
    align: 'center',
    colors: ['yellow', 'green', 'magenta'],
    background: 'black',
    letterSpacing: 1,
    lineHeight: 1,
    space: true,
    maxLength: '0'
});

const proxies = fs.existsSync('proxy.txt') ? fs.readFileSync('proxy.txt', 'utf-8').split('\n').filter(Boolean) : [];
let wallets = fs.existsSync('wallets.json') ? JSON.parse(fs.readFileSync('wallets.json', 'utf-8')) : [];
const existingAddresses = new Set(wallets.map(w => w.address.toLowerCase()));

const BATCH_SIZE = 100;

async function fetchNonce(proxyList, useProxy) {
    const proxy = useProxy && proxyList.length > 0 ? proxyList[Math.floor(Math.random() * proxyList.length)] : null;
    const agent = proxy ? (proxy.startsWith('socks5://') ? new SocksProxyAgent(proxy) : new HttpsProxyAgent(proxy)) : undefined;

    try {
        const response = await axios.get('https://event.goldstation.io/api-v2/public/nonce', {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
                'Content-Type': 'application/json',
                'Accept': '*/*',
                'x-api-key': '03ad7ea4-2b75',
                'Referer': 'https://event.goldstation.io/information'
            },
            timeout: 10000,
            ...(agent && { httpsAgent: agent })
        });

        if (response.data.success) {
            return response.data.data.nonce;
        } else {
            throw new Error('Gagal mendapatkan nonce: ' + (response.data.message || 'Unknown error'));
        }
    } catch (error) {
        throw error;
    }
}

async function sendLoginRequest(wallet, proxyList, useProxy, referralCode, attempt = 1, maxAttempts = 3) {
    const proxy = useProxy && proxyList.length > 0 ? proxyList[Math.floor(Math.random() * proxyList.length)] : null;
    const agent = proxy ? (proxy.startsWith('socks5://') ? new SocksProxyAgent(proxy) : new HttpsProxyAgent(proxy)) : undefined;

    try {
        const nonce = await fetchNonce(proxyList, useProxy);
        const uuid = uuidv4();
        const signature = await wallet.signMessage(nonce);

        const payload = {
            address: wallet.address,
            clickPower: 0.056,
            nonce: nonce,
            referralCode: referralCode,
            signature: signature,
            uuid: uuid,
            walletCode: 1
        };

        const response = await axios.post('https://rwaminer.goldstation.io/api-v2/user/login', payload, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'x-api-key': '03ad7ea4-2b75',
                'Origin': 'https://rwaminer.goldstation.io',
                'Referer': `https://rwaminer.goldstation.io/?referral=${referralCode}`
            },
            timeout: 10000,
            withCredentials: true,
            ...(agent && { httpsAgent: agent })
        });

        if (response.data.success) {
            return { success: true, response };
        } else {
            return { success: false, error: response.data };
        }
    } catch (error) {
        if (attempt < maxAttempts && useProxy && proxyList.length > 1) {
            console.log(chalk.yellow(`⚠️ Attempt ${attempt} gagal untuk wallet ${wallet.address} dengan proxy ${proxy || 'tanpa proxy'}. Mencoba proxy lain...`));
            return sendLoginRequest(wallet, proxyList, useProxy, referralCode, attempt + 1, maxAttempts);
        }
        return { success: false, error };
    }
}

// Main function
(async () => {
    const { walletCount, useProxy, referralCode } = await inquirer.prompt([
        { type: 'number', name: 'walletCount', message: 'Mau buat berapa wallet? 💰', default: 1000 },
        { type: 'confirm', name: 'useProxy', message: 'Mau menggunakan proxy? (y/n) 🌐' },
        { type: 'input', name: 'referralCode', message: 'Masukkan kode referral Anda: '}
    ]);

    console.log(chalk.green.bold('🚀 Starting RWA Miner Autoref Bot... 🚀'));
    await new Promise(resolve => setTimeout(resolve, 2000));

    const validProxies = proxies;
    if (useProxy && validProxies.length > 0) {
        console.log(chalk.yellow(`⏳ Menggunakan ${validProxies.length} proxy dari file...`));
    }

    for (let batchStart = 0; batchStart < walletCount; batchStart += BATCH_SIZE) {
        const batchEnd = Math.min(batchStart + BATCH_SIZE, walletCount);
        console.log(chalk.blue(`🔄 Memproses batch ${batchStart + 1} - ${batchEnd}...`));

        const requests = Array.from({ length: batchEnd - batchStart }, async (_, i) => {
            const wallet = ethers.Wallet.createRandom();
            const result = await sendLoginRequest(wallet, validProxies, useProxy, referralCode);

            if (result.success) {
                console.log(chalk.green(`✔️ Wallet ${batchStart + i + 1} berhasil mendaftarkan wallet Address: ${wallet.address}`));
                fs.appendFileSync('tokens.txt', `${result.response.data.data.token}\n`);
                if (!existingAddresses.has(wallet.address.toLowerCase())) {
                    wallets.push({
                        address: wallet.address,
                        privateKey: wallet.privateKey,
                        mnemonic: wallet.mnemonic.phrase
                    });
                    fs.writeFileSync('wallets.json', JSON.stringify(wallets, null, 2));
                }
            } else {
                console.log(chalk.red(`❌ Gagal mendaftar untuk wallet ${batchStart + i + 1}:`), result.error.response?.status || result.error.message || result.error);
                if (result.error.response?.data) {
                    console.log(chalk.red('🛠 Detail Error Response:'), result.error.response.data);
                }
            }
        });

        await Promise.all(requests);
    }

    console.log(chalk.green('🎯 Semua wallet selesai diproses! 🎯'));
})();
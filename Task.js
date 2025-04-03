import axios from 'axios';
import chalk from 'chalk';
import figlet from 'figlet';
import { promises as fs } from 'fs';
import { HttpProxyAgent } from 'http-proxy-agent';
import { SocksProxyAgent } from 'socks-proxy-agent';
import { createInterface } from 'readline/promises';
import { ethers } from 'ethers';
import { v4 as uuidv4 } from 'uuid';
import ora from 'ora';

// Banner menggunakan figlet
console.log(chalk.yellow(figlet.textSync('Airdrop 888', { font: 'Standard' })));
console.log(chalk.green('Script by @balveerxyz | Auto Task RWA Miner 🌟\n'));

// Setup readline untuk input pengguna
const readline = createInterface({
    input: process.stdin,
    output: process.stdout
});

// Load Wallets
async function loadWallets() {
    const spinner = ora('Loading wallets... ⏳').start();
    try {
        const walletData = await fs.readFile('wallets.json', 'utf8');
        spinner.succeed(chalk.green('Wallets loaded ✅'));
        return JSON.parse(walletData);
    } catch (error) {
        spinner.fail(chalk.red(`Error loading wallets: ${error.message} ❌`));
        return null;
    }
}

// Ambil proxy dari daftar tanpa validasi awal
function getProxyAgent(proxy) {
    console.log(chalk.blue(`Using proxy: ${proxy} 🔗`));
    return proxy.startsWith('http://') ? new HttpProxyAgent(proxy) : new SocksProxyAgent(proxy);
}

// Request dengan proxy, switching jika gagal, dan debug redirect
async function requestWithProxy(config, proxies, proxyIndex = 0, maxRetries = 3) {
    const spinner = ora('Sending request... ⏳').start();
    let attempts = 0;

    while (attempts < maxRetries) {
        if (proxies.length === 0 || proxyIndex >= proxies.length) {
            console.log(chalk.yellow('No more proxies. Trying without proxy... ⚠️'));
            config.httpsAgent = config.httpAgent = null;
        } else {
            config.httpsAgent = config.httpAgent = getProxyAgent(proxies[proxyIndex]);
        }

        try {
            const response = await axios(config);
            console.log(chalk.gray(`Response status: ${response.status}, Headers: ${JSON.stringify(response.headers)}`)); // Debug
            spinner.succeed(chalk.green('Request successful ✅'));
            return { response, proxyIndex };
        } catch (err) {
            attempts++;
            if (err.response) {
                console.log(chalk.gray(`Error status: ${err.response.status}, Redirect: ${err.response.headers.location || 'none'}`)); // Debug redirect
            }
            spinner.fail(chalk.yellow(`Request failed (attempt ${attempts}/${maxRetries}): ${err.message} 🔄`));
            if (attempts >= maxRetries) {
                spinner.fail(chalk.red('Max retries reached. Skipping request ❌'));
                return { response: null, proxyIndex: proxyIndex >= proxies.length ? null : proxyIndex };
            }
            if (proxyIndex + 1 < proxies.length) {
                proxyIndex++; // Pindah ke proxy berikutnya
            }
            await new Promise(resolve => setTimeout(resolve, 2000)); // Delay sebelum retry
        }
    }
}

// Generate random delay between 5-10 seconds (diperpanjang untuk menghindari rate limit)
function randomDelay() {
    const delay = Math.floor(Math.random() * 5000) + 5000; // 5-10 detik
    console.log(chalk.blue(`Waiting ${delay}ms... ⏳`));
    return new Promise(resolve => setTimeout(resolve, delay));
}

// Fungsi untuk mengambil nonce dari server
async function getNonce(proxies, proxyIndex) {
    const spinner = ora(chalk.blue('Fetching nonce...')).start();
    const config = {
        method: 'GET',
        url: 'https://event.goldstation.io/api-v2/public/nonce',
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
            'Accept': 'application/json',
            'x-api-key': '03ad7ea4-2b75',
            'Origin': 'https://event.goldstation.io',
            'Referer': 'https://event.goldstation.io/mine'
        },
        timeout: 60000,
        maxRedirects: 5 // Batasi redirect otomatis
    };

    try {
        const { response, proxyIndex: newProxyIndex } = await requestWithProxy(config, proxies, proxyIndex);
        if (response && response.data.success && response.data.data.nonce) {
            spinner.succeed(chalk.green('Nonce fetched ✅'));
            return { nonce: response.data.data.nonce, proxyIndex: newProxyIndex };
        }
        spinner.fail(chalk.red('Failed to fetch nonce ❌'));
        return { nonce: null, proxyIndex: newProxyIndex };
    } catch (error) {
        spinner.fail(chalk.red(`Nonce error: ${error.message} ❌`));
        return { nonce: null, proxyIndex: null };
    }
}

// Generate Signature dan Login
async function loginAndGetToken(wallet, proxies, proxyIndex) {
    const spinner = ora(chalk.cyan(`Logging in for wallet: ${wallet.address} 🔑`)).start();
    const uuid = uuidv4();

    const { nonce, proxyIndex: newProxyIndex } = await getNonce(proxies, proxyIndex);
    if (!nonce) {
        spinner.fail(chalk.red('Login aborted: No valid nonce ❌'));
        return { token: null, proxyIndex: newProxyIndex };
    }

    const signer = new ethers.Wallet(wallet.privateKey);
    const signature = await signer.signMessage(nonce);

    const config = {
        method: 'POST',
        url: 'https://event.goldstation.io/api-v2/user/login',
        data: {
            address: wallet.address,
            clickPower: 0.035,
            nonce,
            signature,
            uuid,
            walletCode: 1
        },
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'x-api-key': '03ad7ea4-2b75',
            'Origin': 'https://event.goldstation.io',
            'Referer': 'https://event.goldstation.io/mine'
        },
        timeout: 60000,
        maxRedirects: 5 // Batasi redirect otomatis
    };

    try {
        const { response, proxyIndex: finalProxyIndex } = await requestWithProxy(config, proxies, newProxyIndex);
        if (response && response.data.success && response.data.data.token) {
            const token = response.data.data.token;
            await fs.appendFile('tokens.txt', `${token}\n`, 'utf8');
            spinner.succeed(chalk.green('Login successful, token saved ✅'));
            return { token, proxyIndex: finalProxyIndex };
        }
        spinner.fail(chalk.red('Login failed: No token ❌'));
        return { token: null, proxyIndex: finalProxyIndex };
    } catch (err) {
        spinner.fail(chalk.red(`Login error: ${err.message} ❌`));
        return { token: null, proxyIndex: null };
    }
}

// Fetch Task Status (GET)
async function fetchTaskStatus(token, proxies, proxyIndex) {
    const spinner = ora(chalk.blue('Fetching tasks... 📋')).start();
    const fetchConfig = {
        method: 'GET',
        url: 'https://event.goldstation.io/api-v2/user/mission',
        headers: {
            'Authorization': `Bearer ${token}`,
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
            'x-api-key': '03ad7ea4-2b75'
        },
        timeout: 60000,
        maxRedirects: 5 // Batasi redirect otomatis
    };

    try {
        const { response, proxyIndex: newProxyIndex } = await requestWithProxy(fetchConfig, proxies, proxyIndex);
        if (response && response.data.success) {
            const tasks = response.data.data.missionHistory || [];
            spinner.succeed(chalk.yellow(`Found ${tasks.length} tasks 📋`));
            return { tasks, proxyIndex: newProxyIndex };
        }
        spinner.fail(chalk.red('Failed to fetch tasks ❌'));
        return { tasks: [], proxyIndex: newProxyIndex };
    } catch (err) {
        spinner.fail(chalk.red(`Tasks error: ${err.message} ❌`));
        return { tasks: [], proxyIndex: null };
    }
}

// Claim Task (POST)
async function claimTask(token, missionId, proxies, proxyIndex) {
    const spinner = ora(chalk.blue(`Claiming task ${missionId}... 🎁`)).start();
    const claimConfig = {
        method: 'POST',
        url: 'https://event.goldstation.io/api-v2/user/mission',
        data: { missionId },
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
            'x-api-key': '03ad7ea4-2b75'
        },
        timeout: 60000,
        maxRedirects: 5 // Batasi redirect otomatis
    };

    try {
        const { response, proxyIndex: newProxyIndex } = await requestWithProxy(claimConfig, proxies, proxyIndex);
        if (response && response.status === 201 && response.data.success) {
            spinner.succeed(chalk.green(`Task ${missionId} claimed 🎉`));
            return { success: true, proxyIndex: newProxyIndex };
        }
        spinner.fail(chalk.red(`Claim failed: ${response?.data.message || 'Unknown error'} ❌`));
        return { success: false, proxyIndex: newProxyIndex };
    } catch (err) {
        spinner.fail(chalk.red(`Claim error: ${err.message} ❌`));
        return { success: false, proxyIndex: null };
    }
}

// Process Tasks: Fetch and Process Remaining Tasks
async function processTasks(token, proxies, proxyIndex) {
    const { tasks, proxyIndex: newProxyIndex } = await fetchTaskStatus(token, proxies, proxyIndex);
    let currentProxyIndex = newProxyIndex;

    const task1 = tasks.find(t => t.id === 1);
    if (task1 && task1.complete && !task1.claimed) {
        console.log(chalk.blue('Task 1 completed but not claimed. Claiming now... 🎁'));
        const { success, proxyIndex: updatedProxyIndex } = await claimTask(token, 1, proxies, currentProxyIndex);
        currentProxyIndex = updatedProxyIndex;
        if (!success) console.log(chalk.red('Failed to claim Task 1 ❌'));
    }

    for (const task of tasks) {
        if (task.id === 1) continue;
        if (task.complete && task.claimed) {
            console.log(chalk.blue(`Task ${task.id} already claimed 🔄`));
            continue;
        }
        if (task.complete && !task1?.claimed) {
            console.log(chalk.blue(`Task ${task.id} completed, claiming... 🎁`));
            const { proxyIndex: updatedProxyIndex } = await claimTask(token, task.id, proxies, currentProxyIndex);
            currentProxyIndex = updatedProxyIndex;
            continue;
        }
        if (!task.complete) {
            console.log(chalk.yellow(`Task ${task.id} not completed, attempting claim... ⚠️`));
            const { proxyIndex: updatedProxyIndex } = await claimTask(token, task.id, proxies, currentProxyIndex);
            currentProxyIndex = updatedProxyIndex;
        }
    }
    return currentProxyIndex;
}

// Process Single Wallet with One Proxy
async function processWallet(wallet, proxies) {
    console.log(chalk.blue(`Processing wallet: ${wallet.address} 💰`));
    
    let proxyIndex = 0;
    const { token, proxyIndex: finalProxyIndex } = await loginAndGetToken(wallet, proxies, proxyIndex);
    if (token) {
        console.log(chalk.blue('Using token:'), token.substring(0, 15) + '... 🔒');
        await randomDelay();
        await processTasks(token, proxies, finalProxyIndex);
    } else {
        console.log(chalk.red('Login failed, skipping wallet ❌'));
    }
}

// Main Function
async function main() {
    let proxies = [];

    const answer = await readline.question(chalk.yellow('Use proxy? (y/n): '));
    if (answer.toLowerCase() === 'y') {
        try {
            const proxyData = await fs.readFile('proxy.txt', 'utf8');
            proxies = proxyData.split('\n').map(p => p.trim()).filter(p => p);
            if (proxies.length === 0) {
                console.log(chalk.red('proxy.txt is empty! ❌'));
                readline.close();
                return;
            }
            console.log(chalk.blue(`Loaded ${proxies.length} proxies from proxy.txt 🔌`));
        } catch (error) {
            console.log(chalk.red(`Error loading proxy.txt: ${error.message} ❌`));
            readline.close();
            return;
        }
    } else {
        console.log(chalk.blue('Not using proxy 🔌'));
    }

    const wallets = await loadWallets();
    if (!wallets || !Array.isArray(wallets)) {
        console.log(chalk.red('Wallets invalid or empty! ❌'));
        readline.close();
        return;
    }

    for (const wallet of wallets) {
        await processWallet(wallet, proxies);
        await randomDelay();
    }

    readline.close();
}

main().catch(error => {
    console.log(chalk.red(`Main error: ${error.message} ❌`));
    readline.close();
});
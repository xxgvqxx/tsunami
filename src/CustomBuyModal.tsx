import React, { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle, ChevronRight, DollarSign, X, Info, Search, Clock, Settings } from 'lucide-react';
import { getWallets } from './Utils';
import { useToast } from "./Notifications";
import { loadConfigFromCookies } from './Utils';
import { DelaysCurveComponent } from './DelaysCurveComponent';
import * as web3 from '@solana/web3.js';
import bs58 from 'bs58';

const STEPS_CUSTOMBUY = ['Select Wallets', 'Configure Buy', 'Review'];

interface BaseModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface CustomBuyModalProps extends BaseModalProps { 
  onCustomBuy: (data: any) => void;
  handleRefresh: () => void;
  tokenAddress: string;
  solBalances: Map<string, number>;
  tokenBalances: Map<string, number>;
}

// Interface for single transaction
interface Transaction {
  transaction: string; // Base58 encoded transaction data
  walletAddress: string;
  amount: number;
}

export const CustomBuyModal: React.FC<CustomBuyModalProps> = ({
  isOpen,
  onClose,
  onCustomBuy,
  handleRefresh,
  tokenAddress,
  solBalances,
  tokenBalances
}) => {
  const [currentStep, setCurrentStep] = useState(0);
  const [selectedWallets, setSelectedWallets] = useState<string[]>([]);
  const [walletAmounts, setWalletAmounts] = useState<Record<string, string>>({}); // Individual amounts per wallet
  const [transactionDelay, setTransactionDelay] = useState<string>('1'); // Delay in seconds between transactions
  const [useCurveDelay, setUseCurveDelay] = useState(false); // Toggle between fixed and curve delay
  const [walletDelays, setWalletDelays] = useState<number[]>([]); // Per-wallet delays from curve
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isConfirmed, setIsConfirmed] = useState(false);
  const [tokenInfo, setTokenInfo] = useState<{ symbol: string } | null>(null);
  const [isLoadingTokenInfo, setIsLoadingTokenInfo] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [showInfoTip, setShowInfoTip] = useState(false);
  const [sortOption, setSortOption] = useState('address');
  const [sortDirection, setSortDirection] = useState('asc');
  const [balanceFilter, setBalanceFilter] = useState('all');
  const [bulkAmount, setBulkAmount] = useState('0.1');
  const [currentTransactionIndex, setCurrentTransactionIndex] = useState(0);
  const [transactionResults, setTransactionResults] = useState<any[]>([]);
  const [selectedProtocol, setSelectedProtocol] = useState<string>('auto'); // Default to auto

  const wallets = getWallets();
  const { showToast } = useToast();

  // DEX/Protocol options (removed auto option)
  const protocolOptions = [
    { value: 'auto', label: '⭐ Auto', icon: '⭐' },
    { value: 'raydium', label: 'Raydium' },
    { value: 'pumpfun', label: 'Pump.fun' },
    { value: 'moonshot', label: 'Moonshot' },
    { value: 'pumpswap', label: 'PumpSwap' },
    { value: 'launchpad', label: 'Launchpad' },
    { value: 'boopfun', label: 'Boop.fun' }
  ];

  // Format SOL balance for display
  const formatSolBalance = (balance: number) => {
    return balance.toFixed(4);
  };

  // Format token balance for display
  const formatTokenBalance = (balance: number | undefined) => {
    if (balance === undefined) return '0';
    // Use different formatting logic for very small or very large numbers
    if (balance < 0.001 && balance > 0) {
      return balance.toExponential(4);
    }
    return balance.toLocaleString(undefined, { maximumFractionDigits: 4 });
  };
  
  // Filter wallets based on search term, sort option, and balance filter
  const filteredWallets = useMemo(() => {
    if (!wallets) return [];
    
    // Apply search filter
    let filtered = wallets;
    if (searchTerm) {
      filtered = filtered.filter(wallet => 
        wallet.address.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }
    
    // Always filter out wallets with zero SOL balance
    filtered = filtered.filter(wallet => (solBalances.get(wallet.address) || 0) > 0);
    
    // Apply additional balance filter
    if (balanceFilter !== 'all') {
      if (balanceFilter === 'highBalance') {
        filtered = filtered.filter(wallet => (solBalances.get(wallet.address) || 0) >= 0.1);
      } else if (balanceFilter === 'lowBalance') {
        filtered = filtered.filter(wallet => {
          const balance = solBalances.get(wallet.address) || 0;
          return balance < 0.1;
        });
      } else if (balanceFilter === 'hasToken') {
        filtered = filtered.filter(wallet => (tokenBalances.get(wallet.address) || 0) > 0);
      } else if (balanceFilter === 'noToken') {
        filtered = filtered.filter(wallet => (tokenBalances.get(wallet.address) || 0) === 0);
      }
    }
    
    // Sort wallets
    return filtered.sort((a, b) => {
      if (sortOption === 'address') {
        return sortDirection === 'asc' 
          ? a.address.localeCompare(b.address)
          : b.address.localeCompare(a.address);
      } else if (sortOption === 'balance') {
        const balanceA = solBalances.get(a.address) || 0;
        const balanceB = solBalances.get(b.address) || 0;
        return sortDirection === 'asc' ? balanceA - balanceB : balanceB - balanceA;
      } else if (sortOption === 'tokenBalance') {
        const balanceA = tokenBalances.get(a.address) || 0;
        const balanceB = tokenBalances.get(b.address) || 0;
        return sortDirection === 'asc' ? balanceA - balanceB : balanceB - balanceA;
      }
      return 0;
    });
  }, [wallets, searchTerm, balanceFilter, sortOption, sortDirection, solBalances, tokenBalances]);

  useEffect(() => {
    if (isOpen) {
      resetForm();
      handleRefresh();
    }
  }, [isOpen, tokenAddress]);



  // Initialize wallet amounts when wallets are selected/deselected
  useEffect(() => {
    const newWalletAmounts = { ...walletAmounts };
    
    // Add new wallets with default amount
    selectedWallets.forEach(wallet => {
      if (!newWalletAmounts[wallet]) {
        newWalletAmounts[wallet] = '0.1';
      }
    });
    
    // Remove unselected wallets
    Object.keys(newWalletAmounts).forEach(wallet => {
      if (!selectedWallets.includes(wallet)) {
        delete newWalletAmounts[wallet];
      }
    });
    
    setWalletAmounts(newWalletAmounts);
  }, [selectedWallets]);

  const resetForm = () => {
    setSelectedWallets([]);
    setWalletAmounts({});
    setTransactionDelay('1');
    setUseCurveDelay(false);
    setWalletDelays([]);
    setSelectedProtocol('auto');
    setIsConfirmed(false);
    setCurrentStep(0);
    setSearchTerm('');
    setBulkAmount('0.1');
    setSortOption('address');
    setSortDirection('asc');
    setBalanceFilter('all');
    setCurrentTransactionIndex(0);
    setTransactionResults([]);
  };

  // Handle delays from curve component
  const handleDelaysChange = (delays: number[]) => {
    setWalletDelays(delays);
  };

  // Helper to get wallet address from private key
  const getWalletAddressFromKey = (privateKey: string): string => {
    const wallet = wallets.find(w => w.privateKey === privateKey);
    return wallet ? wallet.address : '';
  };

  // Get unsigned transaction for a single wallet
  const getUnsignedTransaction = async (
    walletAddress: string,
    amount: number
  ): Promise<string> => {
    try {
      const baseUrl = (window as any).tradingServerUrl.replace(/\/+$/, '');
      
      const response = await fetch(`${baseUrl}/api/tokens/buy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          walletAddresses: [walletAddress],
          tokenAddress,
          solAmount: amount,
          protocol: selectedProtocol,
          amounts: [amount]
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! Status: ${response.status}`);
      }

      const data = await response.json();
      
      if (!data.success) {
        throw new Error(data.error || 'Failed to get unsigned transaction');
      }
      
      // Extract the first transaction from the response
      if (data.bundles && Array.isArray(data.bundles) && data.bundles[0]?.transactions?.[0]) {
        return data.bundles[0].transactions[0];
      } else if (data.transactions && Array.isArray(data.transactions) && data.transactions[0]) {
        return data.transactions[0];
      } else if (Array.isArray(data) && data[0]) {
        return data[0];
      } else {
        throw new Error('No transaction returned from backend');
      }
    } catch (error) {
      console.error('Error getting unsigned transaction:', error);
      throw error;
    }
  };

  // Sign a single transaction
  const signTransaction = (
    transactionBase58: string,
    privateKey: string
  ): string => {
    try {
      // Create keypair from private key
      const keypair = web3.Keypair.fromSecretKey(bs58.decode(privateKey));

      // Deserialize transaction
      const txBuffer = bs58.decode(transactionBase58);
      const transaction = web3.VersionedTransaction.deserialize(txBuffer);
      
      // Sign the transaction
      transaction.sign([keypair]);
      
      // Serialize and encode the fully signed transaction
      return bs58.encode(transaction.serialize());
    } catch (error) {
      console.error('Error signing transaction:', error);
      throw error;
    }
  };

  // Send a single signed transaction
  const sendSignedTransaction = async (signedTransaction: string): Promise<any> => {
    try {
      const baseUrl = (window as any).tradingServerUrl.replace(/\/+$/, '');
      
      const response = await fetch(`${baseUrl}/api/transactions/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transactions: [signedTransaction],
          useRpc: false
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! Status: ${response.status}`);
      }

      return response.json();
    } catch (error) {
      console.error('Error sending signed transaction:', error);
      throw error;
    }
  };

  // Sleep function for delays
  const sleep = (ms: number): Promise<void> => {
    return new Promise(resolve => setTimeout(resolve, ms));
  };

  const handleNext = () => {
    // Step validations
    if (currentStep === 0) {
      if (selectedWallets.length === 0) {
        showToast('Please select at least one wallet', 'error');
        return;
      }
    }
    if (currentStep === 1) {
      // Check if any wallet has an invalid amount
      const hasInvalidAmount = Object.values(walletAmounts).some(
        amount => !amount || parseFloat(amount) <= 0
      );
      
      if (hasInvalidAmount) {
        showToast('Please enter valid amounts for all wallets', 'error');
        return;
      }

      // Check if delay is valid
      if (!useCurveDelay) {
        const delay = parseFloat(transactionDelay);
        if (isNaN(delay) || delay < 0) {
          showToast('Please enter a valid delay (0 or more seconds)', 'error');
          return;
        }
      } else {
        // For curve mode, ensure we have delays for all wallets
        if (walletDelays.length !== selectedWallets.length) {
          showToast('Please configure delay curve for all selected wallets', 'error');
          return;
        }
      }
    }
    
    setCurrentStep((prev) => Math.min(prev + 1, STEPS_CUSTOMBUY.length - 1));
  };

  const handleBack = () => {
    setCurrentStep((prev) => Math.max(prev - 1, 0));
  };

  // Updated handleCustomBuy function for sequential processing
  const handleCustomBuy = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isConfirmed) return;
    setIsSubmitting(true);
    setCurrentTransactionIndex(0);
    setTransactionResults([]);
    
    const fixedDelay = parseFloat(transactionDelay) * 1000; // Convert to milliseconds
    let successCount = 0;
    let failCount = 0;
    
    const protocolLabel = protocolOptions.find(p => p.value === selectedProtocol)?.label || selectedProtocol;
    const delayType = useCurveDelay ? 'curve delays' : `${transactionDelay}s fixed delay`;
    showToast(`🚀 Starting CUSTOM BUY with ${protocolLabel} using ${delayType}`, 'success');
    
    try {
      for (let i = 0; i < selectedWallets.length; i++) {
        setCurrentTransactionIndex(i + 1);
        
        const privateKey = selectedWallets[i];
        const walletAddress = getWalletAddressFromKey(privateKey);
        const amount = parseFloat(walletAmounts[privateKey]);
        
        
        try {
          // 1. Get unsigned transaction
          const unsignedTransaction = await getUnsignedTransaction(walletAddress, amount);
          
          // 2. Sign transaction
          const signedTransaction = signTransaction(unsignedTransaction, privateKey);
          
          // 3. Send transaction
          const result = await sendSignedTransaction(signedTransaction);
          
          setTransactionResults(prev => [...prev, {
            wallet: walletAddress,
            amount,
            success: true,
            result
          }]);
          
          successCount++;
          
        } catch (error) {
          console.error(`Transaction ${i + 1} failed:`, error);
          setTransactionResults(prev => [...prev, {
            wallet: walletAddress,
            amount,
            success: false,
            error: error.message
          }]);
          
          failCount++;
          showToast(`❌ Transaction ${i + 1} failed for ${walletAddress.slice(0, 8)}...: ${error.message}`, 'error');
        }
        
        // Add delay between transactions (except after the last one)
        if (i < selectedWallets.length - 1) {
          let delayToUse;
          
          if (useCurveDelay && walletDelays.length > i) {
            // Use curve-based delay for this wallet
            delayToUse = walletDelays[i] * 1000; // Convert to milliseconds
          } else {
            // Use fixed delay
            delayToUse = fixedDelay;
          }
          
          if (delayToUse > 0) {
            await sleep(delayToUse);
          }
        }
      }
      
      // Final summary
      showToast(`CUSTOM BUY completed! ${successCount} successful, ${failCount} failed transactions`, successCount > 0 ? 'success' : 'error');
      
      if (successCount > 0) {
        handleRefresh(); // Refresh balances
      }
      
      // Don't close modal immediately so user can see results
      setTimeout(() => {
        resetForm();
        onClose();
      }, 3000);
      
    } catch (error) {
      console.error('CUSTOM BUY execution error:', error);
      showToast(`CUSTOM BUY operation failed: ${error.message}`, 'error');
    } finally {
      setIsSubmitting(false);
      setCurrentTransactionIndex(0);
    }
  };

  // Helper to handle wallet selection
  const toggleWalletSelection = (privateKey: string) => {
    setSelectedWallets(prev => {
      if (prev.includes(privateKey)) {
        return prev.filter(key => key !== privateKey);
      } else {
        return [...prev, privateKey];
      }
    });
  };

  // Helper to handle select/deselect all wallets
  const handleSelectAllWallets = () => {
    if (selectedWallets.length === filteredWallets.length) {
      // If all are selected, deselect all
      setSelectedWallets([]);
    } else {
      // Otherwise, select all
      setSelectedWallets(filteredWallets.map(w => w.privateKey));
    }
  };

  // Helper to update amount for a specific wallet
  const handleWalletAmountChange = (wallet: string, value: string) => {
    if (value === '' || /^\d*\.?\d*$/.test(value)) {
      setWalletAmounts(prev => ({
        ...prev,
        [wallet]: value
      }));
    }
  };

  // Set the same amount for all wallets
  const setAmountForAllWallets = () => {
    if (bulkAmount === '' || parseFloat(bulkAmount) <= 0) return;
    
    const newAmounts = { ...walletAmounts };
    
    selectedWallets.forEach(wallet => {
      newAmounts[wallet] = bulkAmount;
    });
    
    setWalletAmounts(newAmounts);
  };

  // Calculate total buy amount across all wallets
  const calculateTotalBuyAmount = () => {
    return selectedWallets.reduce((total, wallet) => {
      return total + parseFloat(walletAmounts[wallet] || '0');
    }, 0).toFixed(4);
  };

  // Format wallet address for display
  const formatAddress = (address: string) => {
    return `${address.slice(0, 6)}...${address.slice(-6)}`;
  };
  
  // Get wallet display from private key
  const getWalletDisplayFromKey = (privateKey: string) => {
    const wallet = wallets.find(w => w.privateKey === privateKey);
    return wallet 
      ? formatAddress(wallet.address)
      : privateKey.slice(0, 8);
  };

  // Get wallet balance
  const getWalletBalance = (address: string): number => {
    return solBalances.has(address) ? (solBalances.get(address) ?? 0) : 0;
  };

  // Get wallet token balance
  const getWalletTokenBalance = (address: string): number => {
    return tokenBalances.has(address) ? (tokenBalances.get(address) ?? 0) : 0;
  };

  // Add cyberpunk style element to document head
  useEffect(() => {
    if (isOpen) {
      const modalStyleElement = document.createElement('style');
      modalStyleElement.textContent = `
        @keyframes modal-pulse {
          0% { box-shadow: 0 0 5px rgba(2, 179, 109, 0.5), 0 0 15px rgba(2, 179, 109, 0.2); }
          50% { box-shadow: 0 0 15px rgba(2, 179, 109, 0.8), 0 0 25px rgba(2, 179, 109, 0.4); }
          100% { box-shadow: 0 0 5px rgba(2, 179, 109, 0.5), 0 0 15px rgba(2, 179, 109, 0.2); }
        }
        
        @keyframes modal-fade-in {
          0% { opacity: 0; }
          100% { opacity: 1; }
        }
        
        @keyframes modal-slide-up {
          0% { transform: translateY(20px); opacity: 0; }
          100% { transform: translateY(0); opacity: 1; }
        }
        
        @keyframes modal-scan-line {
          0% { transform: translateY(-100%); opacity: 0.3; }
          100% { transform: translateY(100%); opacity: 0; }
        }
        
        .modal-cyberpunk-container {
          animation: modal-fade-in 0.3s ease;
        }
        
        .modal-cyberpunk-content {
          animation: modal-slide-up 0.4s ease;
          position: relative;
        }
        
        .modal-cyberpunk-content::before {
          content: "";
          position: absolute;
          width: 100%;
          height: 5px;
          background: linear-gradient(to bottom, 
            transparent 0%,
            rgba(2, 179, 109, 0.2) 50%,
            transparent 100%);
          z-index: 10;
          animation: modal-scan-line 8s linear infinite;
          pointer-events: none;
        }
        
        .modal-glow {
          animation: modal-pulse 4s infinite;
        }
        
        .modal-input-cyberpunk:focus {
          box-shadow: 0 0 0 1px rgba(2, 179, 109, 0.7), 0 0 15px rgba(2, 179, 109, 0.5);
          transition: all 0.3s ease;
        }
        
        .modal-btn-cyberpunk {
          position: relative;
          overflow: hidden;
          transition: all 0.3s ease;
        }
        
        .modal-btn-cyberpunk::after {
          content: "";
          position: absolute;
          top: -50%;
          left: -50%;
          width: 200%;
          height: 200%;
          background: linear-gradient(
            to bottom right,
            rgba(2, 179, 109, 0) 0%,
            rgba(2, 179, 109, 0.3) 50%,
            rgba(2, 179, 109, 0) 100%
          );
          transform: rotate(45deg);
          transition: all 0.5s ease;
          opacity: 0;
        }
        
        .modal-btn-cyberpunk:hover::after {
          opacity: 1;
          transform: rotate(45deg) translate(50%, 50%);
        }
        
        .modal-btn-cyberpunk:active {
          transform: scale(0.95);
        }
        
        .progress-bar-cyberpunk {
          position: relative;
          overflow: hidden;
        }
        
        .progress-bar-cyberpunk::after {
          content: "";
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: linear-gradient(
            90deg,
            transparent 0%,
            rgba(2, 179, 109, 0.7) 50%,
            transparent 100%
          );
          width: 100%;
          height: 100%;
          transform: translateX(-100%);
          animation: progress-shine 3s infinite;
        }
        
        @keyframes progress-shine {
          0% { transform: translateX(-100%); }
          20% { transform: translateX(100%); }
          100% { transform: translateX(100%); }
        }
        
        .glitch-text:hover {
          text-shadow: 0 0 2px #02b36d, 0 0 4px #02b36d;
          animation: glitch 2s infinite;
        }
        
        @keyframes glitch {
          2%, 8% { transform: translate(-2px, 0) skew(0.3deg); }
          4%, 6% { transform: translate(2px, 0) skew(-0.3deg); }
          62%, 68% { transform: translate(0, 0) skew(0.33deg); }
          64%, 66% { transform: translate(0, 0) skew(-0.33deg); }
        }
      `;
      document.head.appendChild(modalStyleElement);
      
      return () => {
        document.head.removeChild(modalStyleElement);
      };
    }
  }, [isOpen]);

  // Render cyberpunk styled steps
  const renderStepContent = () => {
    switch (currentStep) {
      case 0:
        // Select Wallets
        return (
          <div className="space-y-5 animate-[fadeIn_0.3s_ease]">
            <div className="flex items-center mb-3">
              <div className="w-8 h-8 rounded-full flex items-center justify-center bg-[#02b36d20] mr-3">
                <svg
                  className="w-5 h-5 text-[#02b36d]"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <rect x="2" y="5" width="20" height="14" rx="2" />
                  <path d="M16 10h2M6 14h12" />
                </svg>
              </div>
              <h3 className="text-base font-semibold text-[#e4fbf2] font-mono tracking-wider">
                <span className="text-[#02b36d]">/</span> SELECT WALLETS <span className="text-[#02b36d]">/</span>
              </h3>
            </div>
            
            <div>
              <div className="mb-4 p-4 bg-[#091217] rounded-lg border border-[#02b36d40] relative overflow-hidden">
                <div className="absolute inset-0 z-0 opacity-10"
                     style={{
                       backgroundImage: 'linear-gradient(rgba(2, 179, 109, 0.2) 1px, transparent 1px), linear-gradient(90deg, rgba(2, 179, 109, 0.2) 1px, transparent 1px)',
                       backgroundSize: '20px 20px',
                       backgroundPosition: 'center center',
                     }}>
                </div>
                <h4 className="text-sm font-medium text-[#02b36d] mb-2 font-mono tracking-wider relative z-10">TOKEN INFORMATION</h4>
                <div className="text-sm text-[#e4fbf2] relative z-10 font-mono">
                  <span className="text-[#7ddfbd]">ADDRESS: </span>
                  {tokenAddress}
                </div>
              </div>
              
              <div className="group mb-4">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-medium text-[#7ddfbd] group-hover:text-[#02b36d] transition-colors duration-200 font-mono uppercase tracking-wider">
                    <span className="text-[#02b36d]">&#62;</span> Available Wallets <span className="text-[#02b36d]">&#60;</span>
                  </label>
                  <button 
                    onClick={handleSelectAllWallets}
                    className="text-xs px-3 py-1 bg-[#091217] hover:bg-[#0a1419] text-[#7ddfbd] hover:text-[#02b36d] rounded border border-[#02b36d30] hover:border-[#02b36d] transition-all font-mono tracking-wider modal-btn-cyberpunk"
                  >
                    {selectedWallets.length === filteredWallets.length ? 'DESELECT ALL' : 'SELECT ALL'}
                  </button>
                </div>
                
                <div className="mb-3 flex space-x-2">
                  <div className="relative flex-grow">
                    <Search size={14} className="absolute left-3 top-1/2 transform -translate-y-1/2 text-[#7ddfbd]" />
                    <input
                      type="text"
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="w-full pl-9 pr-4 py-2 bg-[#091217] border border-[#02b36d30] rounded-lg text-sm text-[#e4fbf2] focus:outline-none focus:border-[#02b36d] transition-all modal-input-cyberpunk font-mono"
                      placeholder="SEARCH WALLETS..."
                    />
                  </div>
                  
                  <select 
                    className="bg-[#091217] border border-[#02b36d30] rounded-lg px-2 text-sm text-[#e4fbf2] focus:outline-none focus:border-[#02b36d] modal-input-cyberpunk font-mono"
                    value={sortOption}
                    onChange={(e) => setSortOption(e.target.value)}
                  >
                    <option value="address">ADDRESS</option>
                    <option value="balance">SOL BALANCE</option>
                    <option value="tokenBalance">TOKEN BALANCE</option>
                  </select>
                  
                  <button
                    className="p-2 bg-[#091217] border border-[#02b36d30] rounded-lg text-[#7ddfbd] hover:text-[#02b36d] hover:border-[#02b36d] transition-all modal-btn-cyberpunk"
                    onClick={() => setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc')}
                  >
                    {sortDirection === 'asc' ? '↑' : '↓'}
                  </button>
                  
                  <select 
                    className="bg-[#091217] border border-[#02b36d30] rounded-lg px-2 text-sm text-[#e4fbf2] focus:outline-none focus:border-[#02b36d] modal-input-cyberpunk font-mono"
                    value={balanceFilter}
                    onChange={(e) => setBalanceFilter(e.target.value)}
                  >
                    <option value="all">ALL BALANCES</option>
                    <option value="highBalance">HIGH SOL</option>
                    <option value="lowBalance">LOW SOL</option>
                    <option value="hasToken">HAS TOKEN</option>
                    <option value="noToken">NO TOKEN</option>
                  </select>
                </div>
              </div>
              
              <div className="max-h-64 overflow-y-auto border border-[#02b36d20] rounded-lg shadow-inner bg-[#091217] transition-all duration-200 hover:border-[#02b36d40] scrollbar-thin">
                {filteredWallets.length > 0 ? (
                  filteredWallets.map((wallet) => (
                    <div
                      key={wallet.id}
                      onClick={() => toggleWalletSelection(wallet.privateKey)}
                      className={`flex items-center p-2.5 hover:bg-[#0a1419] cursor-pointer transition-all duration-200 border-b border-[#02b36d20] last:border-b-0
                                ${selectedWallets.includes(wallet.privateKey) ? 'bg-[#02b36d10] border-[#02b36d30]' : ''}`}
                    >
                      <div className={`w-5 h-5 mr-3 rounded flex items-center justify-center transition-all duration-300
                                      ${selectedWallets.includes(wallet.privateKey)
                                        ? 'bg-[#02b36d] shadow-md shadow-[#02b36d40]' 
                                        : 'border border-[#02b36d30] bg-[#091217]'}`}>
                        {selectedWallets.includes(wallet.privateKey) && (
                          <CheckCircle size={14} className="text-[#050a0e] animate-[fadeIn_0.2s_ease]" />
                        )}
                      </div>
                      <div className="flex-1 flex flex-col">
                        <span className="font-mono text-sm text-[#e4fbf2] glitch-text">{formatAddress(wallet.address)}</span>
                        <div className="flex items-center gap-3 mt-0.5">
                          <div className="flex items-center">
                            <DollarSign size={12} className="text-[#7ddfbd] mr-1" />
                            <span className="text-xs text-[#7ddfbd] font-mono">{formatSolBalance(getWalletBalance(wallet.address) || 0)} SOL</span>
                          </div>
                          <div className="flex items-center">
                            <svg className="w-3 h-3 text-[#02b36d] mr-1" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <circle cx="12" cy="12" r="10" />
                              <path d="M12 8v8M8 12h8" />
                            </svg>
                            <span className="text-xs text-[#02b36d] font-mono">{formatTokenBalance(tokenBalances.get(wallet.address))} TOKEN</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="p-3 text-sm text-[#7ddfbd] text-center font-mono">
                    NO WALLETS FOUND MATCHING FILTERS
                  </div>
                )}
              </div>
              
              <div className="mt-2 flex items-center justify-between text-xs">
                <span className="text-[#7ddfbd] font-mono">
                  SELECTED: <span className="text-[#02b36d] font-medium">{selectedWallets.length}</span> WALLETS
                </span>
              </div>
            </div>
          </div>
        );
        
      case 1:
        // Configure Buy
        return (
          <div className="space-y-5 animate-[fadeIn_0.3s_ease]">
            <div className="flex items-center mb-3">
              <div className="w-8 h-8 rounded-full flex items-center justify-center bg-[#02b36d20] mr-3">
                <svg
                  className="w-5 h-5 text-[#02b36d]"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <circle cx="12" cy="12" r="10" />
                  <path d="M12 6v12M6 12h12" />
                </svg>
              </div>
              <h3 className="text-base font-semibold text-[#e4fbf2] font-mono tracking-wider">
                <span className="text-[#02b36d]">/</span> CONFIGURE BUY <span className="text-[#02b36d]">/</span>
              </h3>
            </div>
            
            {/* Bulk amount setter */}
            <div className="bg-[#091217] rounded-lg p-4 border border-[#02b36d40] relative overflow-hidden">
              <div className="absolute inset-0 z-0 opacity-5"
                   style={{
                     backgroundImage: 'linear-gradient(rgba(2, 179, 109, 0.2) 1px, transparent 1px), linear-gradient(90deg, rgba(2, 179, 109, 0.2) 1px, transparent 1px)',
                     backgroundSize: '20px 20px',
                     backgroundPosition: 'center center',
                   }}>
              </div>
              <div className="flex items-center justify-between mb-1 relative z-10">
                <div className="flex items-center gap-1">
                  <label className="text-sm text-[#7ddfbd] font-mono tracking-wider">
                    SET AMOUNT FOR ALL WALLETS (SOL)
                  </label>
                  <div className="relative" onMouseEnter={() => setShowInfoTip(true)} onMouseLeave={() => setShowInfoTip(false)}>
                    <Info size={14} className="text-[#7ddfbd] cursor-help" />
                    {showInfoTip && (
                      <div className="absolute left-0 bottom-full mb-2 p-2 bg-[#091217] border border-[#02b36d30] rounded shadow-lg text-xs text-[#e4fbf2] w-48 z-10 font-mono">
                        AMOUNT IN SOL TO USE FOR EACH WALLET
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex items-center">
                  <div className="relative">
                    <DollarSign size={14} className="absolute left-3 top-1/2 transform -translate-y-1/2 text-[#7ddfbd]" />
                    <input
                      type="text"
                      value={bulkAmount}
                      placeholder="0.1"
                      className="w-32 pl-8 pr-2 py-1.5 bg-[#050a0e] border border-[#02b36d30] rounded text-sm text-[#e4fbf2] focus:outline-none focus:border-[#02b36d] transition-all modal-input-cyberpunk font-mono"
                      onChange={(e) => {
                        const value = e.target.value;
                        if (value === '' || /^\d*\.?\d*$/.test(value)) {
                          setBulkAmount(value);
                        }
                      }}
                    />
                  </div>
                  <button
                    type="button"
                    className="ml-2 bg-[#02b36d] text-xs rounded px-3 py-1.5 hover:bg-[#01a35f] text-[#050a0e] transition-colors font-mono tracking-wider modal-btn-cyberpunk"
                    onClick={setAmountForAllWallets}
                  >
                    APPLY TO ALL
                  </button>
                </div>
              </div>
            </div>
            
            {/* Protocol and Delay settings on same row */}
            <div className="bg-[#091217] rounded-lg p-4 border border-[#02b36d40] relative overflow-hidden">
              <div className="absolute inset-0 z-0 opacity-5"
                   style={{
                     backgroundImage: 'linear-gradient(rgba(2, 179, 109, 0.2) 1px, transparent 1px), linear-gradient(90deg, rgba(2, 179, 109, 0.2) 1px, transparent 1px)',
                     backgroundSize: '20px 20px',
                     backgroundPosition: 'center center',
                   }}>
              </div>
              <div className="grid grid-cols-2 gap-4 relative z-10">
                {/* Protocol selection */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-5 h-5 rounded-full flex items-center justify-center bg-[#02b36d20]">
                      <svg className="w-3 h-3 text-[#02b36d]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M9 12l2 2 4-4" />
                        <path d="M21 12c-1 0-3-1-3-3s2-3 3-3 3 1 3 3-2 3-3 3" />
                        <path d="M3 12c1 0 3-1 3-3s-2-3-3-3-3 1-3 3 2 3 3 3" />
                      </svg>
                    </div>
                    <label className="text-sm text-[#7ddfbd] font-mono tracking-wider">
                      PROTOCOL
                    </label>
                  </div>
                  <div className="flex items-center">
                    <select 
                      value={selectedProtocol}
                      onChange={(e) => setSelectedProtocol(e.target.value)}
                      className="bg-[#050a0e] border border-[#02b36d30] rounded text-sm text-[#e4fbf2] px-3 py-1.5 focus:outline-none focus:border-[#02b36d] transition-all modal-input-cyberpunk font-mono min-w-[120px]"
                    >
                      {protocolOptions.map(option => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    {selectedProtocol === 'auto' && (
                      <span className="ml-2 text-yellow-400 animate-pulse" style={{
                        filter: 'drop-shadow(0 0 8px rgba(255, 215, 0, 0.8))',
                        textShadow: '0 0 10px rgba(255, 215, 0, 0.8)'
                      }}>⭐</span>
                    )}
                  </div>
                </div>
                
                {/* Transaction delay mode selector */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Clock size={16} className="text-[#02b36d]" />
                      <label className="text-sm text-[#7ddfbd] font-mono tracking-wider">
                        DELAY MODE
                      </label>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setUseCurveDelay(false)}
                        className={`px-3 py-1.5 text-xs rounded font-mono transition-all ${
                          !useCurveDelay 
                            ? 'bg-[#02b36d] text-[#050a0e]' 
                            : 'bg-[#02b36d20] text-[#02b36d] border border-[#02b36d40]'
                        }`}
                      >
                        FIXED
                      </button>
                      <button
                        type="button"
                        onClick={() => setUseCurveDelay(true)}
                        className={`px-3 py-1.5 text-xs rounded font-mono transition-all ${
                          useCurveDelay 
                            ? 'bg-[#02b36d] text-[#050a0e]' 
                            : 'bg-[#02b36d20] text-[#02b36d] border border-[#02b36d40]'
                        }`}
                      >
                        <Settings size={12} className="inline mr-1" />
                        CURVE
                      </button>
                    </div>
                  </div>
                  
                  {/* Fixed delay input */}
                  {!useCurveDelay && (
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Clock size={16} className="text-[#02b36d]" />
                        <label className="text-sm text-[#7ddfbd] font-mono tracking-wider">
                          DELAY (SEC)
                        </label>
                      </div>
                      <div className="flex items-center">
                        <div className="relative">
                          <input
                            type="text"
                            value={transactionDelay}
                            placeholder="0.45"
                            className="w-24 px-3 py-1.5 bg-[#050a0e] border border-[#02b36d30] rounded text-sm text-[#e4fbf2] focus:outline-none focus:border-[#02b36d] transition-all modal-input-cyberpunk font-mono text-center"
                            onChange={(e) => {
                              const value = e.target.value;
                              if (value === '' || /^\d*\.?\d*$/.test(value)) {
                                setTransactionDelay(value);
                              }
                            }}
                          />
                        </div>
                      </div>
                    </div>
                  )}
                  
                </div>
              </div>
              <div className="text-xs text-[#7ddfbd] mt-2 font-mono relative z-10">
                {useCurveDelay 
                  ? 'CURVE MODE: DRAG WALLETS TO DESIGN CUSTOM DELAY PATTERNS'
                  : selectedProtocol === 'auto' 
                    ? 'AUTO-SELECTS BEST DEX • SET TO 0 FOR NO DELAY'
                    : `USES ${protocolOptions.find(p => p.value === selectedProtocol)?.label.toUpperCase()} • SET TO 0 FOR NO DELAY`
                }
              </div>
            </div>
            
            {/* Curve delay component - moved underneath protocol section */}
            {useCurveDelay && selectedWallets.length > 0 && (
              <div className="bg-[#091217] rounded-lg p-4 border border-[#02b36d40] relative overflow-hidden">
                <div className="absolute inset-0 z-0 opacity-5"
                     style={{
                       backgroundImage: 'linear-gradient(rgba(2, 179, 109, 0.2) 1px, transparent 1px), linear-gradient(90deg, rgba(2, 179, 109, 0.2) 1px, transparent 1px)',
                       backgroundSize: '20px 20px',
                       backgroundPosition: 'center center',
                     }}>
                </div>
                <div className="relative z-10">
                  <DelaysCurveComponent
                    wallets={selectedWallets.map(pk => ({
                      address: getWalletAddressFromKey(pk),
                      privateKey: pk
                    }))}
                    onDelaysChange={handleDelaysChange}
                    maxDelay={10}
                    minDelay={0}
                    className="w-full"
                  />
                </div>
              </div>
            )}
            
            {/* Individual wallet amounts */}
            <div className="bg-[#091217] rounded-lg p-4 border border-[#02b36d40] relative overflow-hidden">
              <div className="absolute inset-0 z-0 opacity-5"
                   style={{
                     backgroundImage: 'linear-gradient(rgba(2, 179, 109, 0.2) 1px, transparent 1px), linear-gradient(90deg, rgba(2, 179, 109, 0.2) 1px, transparent 1px)',
                     backgroundSize: '20px 20px',
                     backgroundPosition: 'center center',
                   }}>
              </div>
              <h4 className="text-sm font-medium text-[#7ddfbd] mb-3 font-mono tracking-wider relative z-10">INDIVIDUAL WALLET AMOUNTS</h4>
              <div className="max-h-64 overflow-y-auto pr-1 scrollbar-thin relative z-10">
                {selectedWallets.map((privateKey, index) => {
                  const address = getWalletAddressFromKey(privateKey);
                  const solBalance = getWalletBalance(address);
                  const tokenBalance = getWalletTokenBalance(address);
                  
                  return (
                    <div key={privateKey} className="flex items-center justify-between py-2 border-b border-[#02b36d30] last:border-b-0">
                      <div className="flex items-center">
                        <span className="text-[#7ddfbd] text-xs mr-2 w-6 font-mono">{index + 1}.</span>
                        <span className="font-mono text-sm text-[#e4fbf2] glitch-text">{getWalletDisplayFromKey(privateKey)}</span>
                      </div>
                      <div className="flex items-center space-x-3">
                        <div className="flex flex-col items-end">
                          <span className="text-xs text-[#7ddfbd] font-mono">SOL: {formatSolBalance(solBalance)}</span>
                          <span className="text-xs text-[#02b36d] font-mono">TOKEN: {formatTokenBalance(tokenBalance)}</span>
                        </div>
                        <div className="flex items-center">
                          <div className="relative">
                            <DollarSign size={12} className="absolute left-2 top-1/2 transform -translate-y-1/2 text-[#7ddfbd]" />
                            <input
                              type="text"
                              value={walletAmounts[privateKey] || '0.1'}
                              onChange={(e) => handleWalletAmountChange(privateKey, e.target.value)}
                              className="w-24 pl-7 pr-2 py-1.5 bg-[#050a0e] border border-[#02b36d30] rounded text-sm text-[#e4fbf2] focus:outline-none focus:border-[#02b36d] transition-all modal-input-cyberpunk font-mono"
                              placeholder="0.1"
                            />
                          </div>
                          <span className="text-xs text-[#7ddfbd] ml-2 font-mono">SOL</span>
                          {useCurveDelay && walletDelays.length > index && (
                            <div className="ml-3 flex items-center">
                              <Clock size={12} className="text-[#02b36d] mr-1" />
                              <span className="text-xs text-[#02b36d] font-mono font-bold">
                                {walletDelays[index].toFixed(2)}s
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            
            {/* Total summary */}
            <div className="bg-[#02b36d10] border border-[#02b36d40] rounded-lg p-4 modal-glow">
              <div className="flex justify-between mb-2">
                <span className="text-sm font-medium text-[#02b36d] font-mono tracking-wider">TOTAL BUY AMOUNT:</span>
                <span className="text-sm font-medium text-[#02b36d] font-mono tracking-wider">
                  {calculateTotalBuyAmount()} SOL
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm font-medium text-[#02b36d] font-mono tracking-wider">ESTIMATED TIME:</span>
                <span className="text-sm font-medium text-[#02b36d] font-mono tracking-wider">
                  ~{(() => {
                    if (useCurveDelay && walletDelays.length > 0) {
                      // Sum all curve delays plus execution time
                      const totalCurveDelays = walletDelays.reduce((sum, delay) => sum + delay, 0);
                      return Math.ceil(totalCurveDelays + selectedWallets.length * 2);
                    } else {
                      // Fixed delay calculation
                      return Math.ceil((selectedWallets.length - 1) * parseFloat(transactionDelay || '0') + selectedWallets.length * 2);
                    }
                  })()} SEC
                </span>
              </div>
            </div>
          </div>
        );
        
      case 2:
        // Review Operation
        return (
          <div className="space-y-5 animate-[fadeIn_0.3s_ease]">
            <div className="flex items-center mb-3">
              <div className="w-8 h-8 rounded-full flex items-center justify-center bg-[#02b36d20] mr-3">
                <svg
                  className="w-5 h-5 text-[#02b36d]"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </div>
              <h3 className="text-base font-semibold text-[#e4fbf2] font-mono tracking-wider">
                <span className="text-[#02b36d]">/</span> REVIEW OPERATION <span className="text-[#02b36d]">/</span>
              </h3>
            </div>
            
            {/* Transaction progress indicator (only show during processing) */}
            {isSubmitting && (
              <div className="bg-[#091217] rounded-lg p-4 border border-[#02b36d40] relative overflow-hidden mb-4">
                <div className="absolute inset-0 z-0 opacity-5"
                     style={{
                       backgroundImage: 'linear-gradient(rgba(2, 179, 109, 0.2) 1px, transparent 1px), linear-gradient(90deg, rgba(2, 179, 109, 0.2) 1px, transparent 1px)',
                       backgroundSize: '20px 20px',
                       backgroundPosition: 'center center',
                     }}>
                </div>
                <div className="relative z-10">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium text-[#02b36d] font-mono tracking-wider">
                      PROCESSING TRANSACTIONS
                    </span>
                    <span className="text-sm text-[#7ddfbd] font-mono">
                      {currentTransactionIndex}/{selectedWallets.length}
                    </span>
                  </div>
                  <div className="w-full bg-[#050a0e] rounded-full h-2 progress-bar-cyberpunk">
                    <div 
                      className="bg-[#02b36d] h-2 rounded-full transition-all duration-500"
                      style={{ width: `${(currentTransactionIndex / selectedWallets.length) * 100}%` }}
                    ></div>
                  </div>
                </div>
              </div>
            )}
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Left column - Token and Operation Details */}
              <div className="space-y-4">
                {/* Token Details */}
                <div className="bg-[#091217] rounded-lg p-4 border border-[#02b36d40] relative overflow-hidden">
                  <div className="absolute inset-0 z-0 opacity-5"
                       style={{
                         backgroundImage: 'linear-gradient(rgba(2, 179, 109, 0.2) 1px, transparent 1px), linear-gradient(90deg, rgba(2, 179, 109, 0.2) 1px, transparent 1px)',
                         backgroundSize: '20px 20px',
                         backgroundPosition: 'center center',
                       }}>
                  </div>
                  <h4 className="text-sm font-medium text-[#02b36d] mb-3 font-mono tracking-wider relative z-10">
                    TOKEN DETAILS
                  </h4>
                  <div className="space-y-2 relative z-10">
                    <div>
                      <span className="text-sm text-[#7ddfbd] font-mono">
                        ADDRESS:
                      </span>
                      <span className="text-sm text-[#e4fbf2] ml-2 font-mono">
                        {`${tokenAddress.slice(0, 8)}...${tokenAddress.slice(-8)}`}
                      </span>
                    </div>
                    <div>
                      <span className="text-sm text-[#7ddfbd] font-mono">
                        SYMBOL:
                      </span>
                      <span className="text-sm text-[#e4fbf2] ml-2 font-mono">
                        {tokenInfo?.symbol || 'UNKNOWN'}
                      </span>
                    </div>
                  </div>
                </div>
                
                {/* Operation Summary */}
                <div className="bg-[#091217] rounded-lg p-4 border border-[#02b36d40] relative overflow-hidden">
                  <div className="absolute inset-0 z-0 opacity-5"
                       style={{
                         backgroundImage: 'linear-gradient(rgba(2, 179, 109, 0.2) 1px, transparent 1px), linear-gradient(90deg, rgba(2, 179, 109, 0.2) 1px, transparent 1px)',
                         backgroundSize: '20px 20px',
                         backgroundPosition: 'center center',
                       }}>
                  </div>
                  <h4 className="text-sm font-medium text-[#02b36d] mb-3 font-mono tracking-wider relative z-10">
                    OPERATION DETAILS
                  </h4>
                  <div className="space-y-2 relative z-10">
                    <div className="flex justify-between py-1.5 border-b border-[#02b36d30]">
                      <span className="text-sm text-[#7ddfbd] font-mono">PROCESSING MODE: </span>
                      <span className="text-sm text-[#e4fbf2] font-medium font-mono">SEQUENTIAL</span>
                    </div>
                    <div className="flex justify-between py-1.5 border-b border-[#02b36d30]">
                      <span className="text-sm text-[#7ddfbd] font-mono">PROTOCOL: </span>
                      <span className="text-sm text-[#e4fbf2] font-medium font-mono">
                        {protocolOptions.find(p => p.value === selectedProtocol)?.label.toUpperCase()}
                      </span>
                    </div>
                    <div className="flex justify-between py-1.5 border-b border-[#02b36d30]">
                      <span className="text-sm text-[#7ddfbd] font-mono">DELAY MODE: </span>
                      <span className="text-sm text-[#e4fbf2] font-medium font-mono">
                        {useCurveDelay ? 'CUSTOM CURVE' : `${transactionDelay}s FIXED`}
                      </span>
                    </div>
                    <div className="flex justify-between py-1.5 border-b border-[#02b36d30]">
                      <span className="text-sm text-[#7ddfbd] font-mono">TOTAL WALLETS: </span>
                      <span className="text-sm text-[#e4fbf2] font-medium font-mono">{selectedWallets.length}</span>
                    </div>
                    <div className="flex justify-between py-1.5">
                      <span className="text-sm text-[#7ddfbd] font-mono">TOTAL BUY AMOUNT: </span>
                      <span className="text-sm text-[#02b36d] font-medium font-mono">
                        {calculateTotalBuyAmount()} SOL
                      </span>
                    </div>
                  </div>
                </div>
                
                {/* Confirmation */}
                <div className="bg-[#091217] rounded-lg p-4 border border-[#02b36d40] relative overflow-hidden">
                  <div className="absolute inset-0 z-0 opacity-5"
                       style={{
                         backgroundImage: 'linear-gradient(rgba(2, 179, 109, 0.2) 1px, transparent 1px), linear-gradient(90deg, rgba(2, 179, 109, 0.2) 1px, transparent 1px)',
                         backgroundSize: '20px 20px',
                         backgroundPosition: 'center center',
                       }}>
                  </div>
                  <div className="flex items-start gap-3 relative z-10">
                    <div className="relative mt-1">
                      <input
                        type="checkbox"
                        id="confirm"
                        checked={isConfirmed}
                        onChange={(e) => setIsConfirmed(e.target.checked)}
                        className="peer sr-only"
                      />
                      <div className="w-5 h-5 border border-[#02b36d40] rounded-md peer-checked:bg-[#02b36d] peer-checked:border-0 transition-all"></div>
                      <CheckCircle size={14} className={`absolute top-0.5 left-0.5 text-[#050a0e] transition-all ${isConfirmed ? 'opacity-100' : 'opacity-0'}`} />
                    </div>
                    <label htmlFor="confirm" className="text-sm text-[#7ddfbd] leading-relaxed font-mono">
                      I CONFIRM THAT I WANT TO BUY {tokenInfo?.symbol || 'TOKEN'} USING THE SPECIFIED AMOUNTS
                      ACROSS {selectedWallets.length} WALLETS WITH {useCurveDelay ? 'CUSTOM CURVE DELAYS' : `${transactionDelay}s FIXED DELAY`} BETWEEN TRANSACTIONS
                      VIA {protocolOptions.find(p => p.value === selectedProtocol)?.label.toUpperCase()} PROTOCOL. 
                      TRANSACTIONS WILL BE PROCESSED SEQUENTIALLY. THIS ACTION CANNOT BE UNDONE.
                    </label>
                  </div>
                </div>
              </div>
              
              {/* Right column - Selected Wallets */}
              <div>
                <div className="bg-[#091217] rounded-lg p-4 border border-[#02b36d40] h-full relative overflow-hidden">
                  <div className="absolute inset-0 z-0 opacity-5"
                       style={{
                         backgroundImage: 'linear-gradient(rgba(2, 179, 109, 0.2) 1px, transparent 1px), linear-gradient(90deg, rgba(2, 179, 109, 0.2) 1px, transparent 1px)',
                         backgroundSize: '20px 20px',
                         backgroundPosition: 'center center',
                       }}>
                  </div>
                  <h4 className="text-sm font-medium text-[#02b36d] mb-3 font-mono tracking-wider relative z-10">
                    SELECTED WALLETS
                  </h4>
                  
                  <div className="max-h-64 overflow-y-auto pr-1 scrollbar-thin relative z-10">
                    {selectedWallets.map((privateKey, index) => {
                      const address = getWalletAddressFromKey(privateKey);
                      const solBalance = getWalletBalance(address);
                      const tokenBalance = getWalletTokenBalance(address);
                      
                      return (
                        <div key={privateKey} className="flex justify-between py-1.5 border-b border-[#02b36d30] last:border-b-0">
                          <div className="flex items-center">
                            <span className="text-[#7ddfbd] text-xs mr-2 w-6 font-mono">{index + 1}.</span>
                            <div className="flex flex-col">
                              <span className="font-mono text-sm text-[#e4fbf2] glitch-text">{getWalletDisplayFromKey(privateKey)}</span>
                              <div className="flex space-x-2 text-xs">
                                <span className="text-[#7ddfbd] font-mono">SOL: {formatSolBalance(solBalance)}</span>
                                <span className="text-[#02b36d] font-mono">TOKEN: {formatTokenBalance(tokenBalance)}</span>
                              </div>
                            </div>
                          </div>
                          <div className="flex flex-col items-end justify-center">
                            <span className="text-[#02b36d] font-medium font-mono">{walletAmounts[privateKey]} SOL</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          </div>
        );
        
      default:
        return null;
    }
  };

  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center backdrop-blur-sm modal-cyberpunk-container" style={{backgroundColor: 'rgba(5, 10, 14, 0.85)'}}>
      <div className="relative bg-[#050a0e] border border-[#02b36d40] rounded-lg shadow-lg w-full max-w-5xl md:h-auto overflow-hidden transform modal-cyberpunk-content modal-glow">
        {/* Ambient grid background */}
        <div className="absolute inset-0 z-0 opacity-10"
             style={{
               backgroundImage: 'linear-gradient(rgba(2, 179, 109, 0.2) 1px, transparent 1px), linear-gradient(90deg, rgba(2, 179, 109, 0.2) 1px, transparent 1px)',
               backgroundSize: '20px 20px',
               backgroundPosition: 'center center',
             }}>
        </div>

        {/* Header */}
        <div className="relative z-10 p-4 flex justify-between items-center border-b border-[#02b36d40]">
          <div className="flex items-center">
            <div className="w-8 h-8 rounded-full flex items-center justify-center bg-[#02b36d20] mr-3">
              <DollarSign size={16} className="text-[#02b36d]" />
            </div>
            <h2 className="text-lg font-semibold text-[#e4fbf2] font-mono">
              <span className="text-[#02b36d]">/</span> CUSTOM BUY <span className="text-[#02b36d]">/</span>
            </h2>
          </div>
          <button 
            onClick={onClose}
            className="text-[#7ddfbd] hover:text-[#02b36d] transition-colors p-1 hover:bg-[#02b36d20] rounded"
          >
            <X size={18} />
          </button>
        </div>

        {/* Progress Indicator */}
        <div className="relative w-full h-1 bg-[#091217] progress-bar-cyberpunk">
          <div 
            className="h-full bg-[#02b36d] transition-all duration-300"
            style={{ width: `${(currentStep + 1) / STEPS_CUSTOMBUY.length * 100}%` }}
          ></div>
        </div>

        {/* Content */}
        <div className="relative z-10 p-5 lg:p-6 overflow-y-auto max-h-[80vh]">
          <form
            onSubmit={
              currentStep === STEPS_CUSTOMBUY.length - 1
                ? handleCustomBuy
                : (e) => e.preventDefault()
            }
          >
            {renderStepContent()}
            
            {/* Action Buttons */}
            <div className="flex justify-between mt-8 pt-4 border-t border-[#02b36d40]">
              <button
                type="button"
                onClick={currentStep === 0 ? onClose : handleBack}
                disabled={isSubmitting}
                className="px-5 py-2.5 text-[#e4fbf2] bg-[#091217] border border-[#02b36d30] hover:bg-[#0a1419] hover:border-[#02b36d] rounded-lg transition-all duration-200 shadow-md font-mono tracking-wider modal-btn-cyberpunk"
              >
                {currentStep === 0 ? 'CANCEL' : 'BACK'}
              </button>
              <button
                type={currentStep === STEPS_CUSTOMBUY.length - 1 ? 'submit' : 'button'}
                onClick={currentStep === STEPS_CUSTOMBUY.length - 1 ? undefined : handleNext}
                disabled={
                  isSubmitting ||
                  (currentStep === STEPS_CUSTOMBUY.length - 1 && !isConfirmed)
                }
                className={`px-5 py-2.5 rounded-lg shadow-lg flex items-center transition-all duration-300 font-mono tracking-wider 
                          ${isSubmitting || (currentStep === STEPS_CUSTOMBUY.length - 1 && !isConfirmed)
                            ? 'bg-[#02b36d50] text-[#050a0e80] cursor-not-allowed opacity-50' 
                            : 'bg-[#02b36d] text-[#050a0e] hover:bg-[#01a35f] transform hover:-translate-y-0.5 modal-btn-cyberpunk'}`}
              >
                {isSubmitting ? (
                  <>
                    <div className="h-4 w-4 rounded-full border-2 border-[#050a0e80] border-t-transparent animate-spin mr-2"></div>
                    PROCESSING...
                  </>
                ) : (
                  <>
                    {currentStep === STEPS_CUSTOMBUY.length - 1 ? 'CONFIRM OPERATION' : (
                      <span className="flex items-center">
                        NEXT
                        <ChevronRight size={16} className="ml-1" />
                      </span>
                    )}
                  </>
                )}
              </button>
            </div>
          </form>
        </div>
        
        {/* Cyberpunk decorative corner elements */}
        <div className="absolute top-0 left-0 w-4 h-4 border-t-2 border-l-2 border-[#02b36d] opacity-70"></div>
        <div className="absolute top-0 right-0 w-4 h-4 border-t-2 border-r-2 border-[#02b36d] opacity-70"></div>
        <div className="absolute bottom-0 left-0 w-4 h-4 border-b-2 border-l-2 border-[#02b36d] opacity-70"></div>
        <div className="absolute bottom-0 right-0 w-4 h-4 border-b-2 border-r-2 border-[#02b36d] opacity-70"></div>
      </div>
    </div>,
    document.body
  );
};
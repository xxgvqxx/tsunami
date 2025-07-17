import React, { useRef, useEffect, useState, useCallback } from 'react';
import * as d3 from 'd3';
import { Clock, RotateCcw, TrendingUp, Shuffle, Minus, FlipVertical } from 'lucide-react';

interface WalletPosition {
  walletIndex: number;
  walletAddress: string;
  x: number; // time position (0-100)
  y: number; // delay value (0-100, maps to actual seconds)
  calculatedDelay: number; // actual delay in seconds
}

interface DelaysCurveComponentProps {
  wallets: Array<{ address: string; privateKey: string }>;
  onDelaysChange: (delays: number[]) => void;
  maxDelay?: number; // maximum delay in seconds
  minDelay?: number; // minimum delay in seconds
  className?: string;
}

export const DelaysCurveComponent: React.FC<DelaysCurveComponentProps> = ({
  wallets,
  onDelaysChange,
  maxDelay = 10,
  minDelay = 0,
  className = ''
}) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const [walletPositions, setWalletPositions] = useState<WalletPosition[]>([]);
  const [curveType, setCurveType] = useState<'linear' | 'exponential' | 'random' | 'custom'>('exponential');
  const [isFlipped, setIsFlipped] = useState(false); // Flip curve direction
  const [userMaxDelay, setUserMaxDelay] = useState(maxDelay); // User-controllable max delay
  const [maxDelayInput, setMaxDelayInput] = useState(maxDelay.toString()); // Input string value
  const [containerRef, setContainerRef] = useState<HTMLDivElement | null>(null);


  // Graph dimensions - responsive
  const margin = { top: 20, right: 30, bottom: 40, left: 60 };
  const containerWidth = containerRef?.offsetWidth || 800;
  const width = containerWidth - margin.left - margin.right;
  const height = 400 - margin.top - margin.bottom;

  // Initialize wallet positions - only when wallets change or on first load
  useEffect(() => {
    if (wallets.length > 0 && walletPositions.length === 0) {
      const positions = wallets.map((wallet, index) => {
        // Spread wallets across full X-axis range (0% to 100%)
        const x = (index / Math.max(wallets.length - 1, 1)) * 100;
        
        // Initialize with exponential curve by default
        const normalizedIndex = index / Math.max(wallets.length - 1, 1);
        let y = Math.pow(normalizedIndex, 2) * 100;
        
        // Apply flip if enabled
        if (isFlipped) {
          y = 100 - y;
        }
        
        const calculatedDelay = (y / 100) * userMaxDelay;
        
        return {
          walletIndex: index,
          walletAddress: wallet.address,
          x,
          y,
          calculatedDelay
        };
      });
      
      setWalletPositions(positions);
      updateDelays(positions);
    }
  }, [wallets, userMaxDelay, isFlipped]);

  // Handle wallet count changes (when wallets are added/removed)
  useEffect(() => {
    if (wallets.length !== walletPositions.length && wallets.length > 0) {
      // Reinitialize if wallet count changed
      const positions = wallets.map((wallet, index) => {
        const x = (index / Math.max(wallets.length - 1, 1)) * 100;
        const normalizedIndex = index / Math.max(wallets.length - 1, 1);
        let y = Math.pow(normalizedIndex, 2) * 100;
        
        if (isFlipped) {
          y = 100 - y;
        }
        
        const calculatedDelay = (y / 100) * userMaxDelay;
        
        return {
          walletIndex: index,
          walletAddress: wallet.address,
          x,
          y,
          calculatedDelay
        };
      });
      
      setWalletPositions(positions);
      updateDelays(positions);
    }
  }, [wallets.length]);



  const updateDelays = useCallback((positions: WalletPosition[]) => {
    const delays = positions.map(pos => pos.calculatedDelay);
    onDelaysChange(delays);
  }, [onDelaysChange]);

  // Re-render when container is resized
  useEffect(() => {
    const handleResize = () => {
      if (containerRef) {
        // Force re-render by updating a dummy state
        setWalletPositions(prev => [...prev]);
      }
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [containerRef]);

  // Scale functions
  const xScale = d3.scaleLinear().domain([0, 100]).range([0, width]);
  const yScale = d3.scaleLinear().domain([0, 100]).range([height, 0]);

  // Generate line path connecting wallet points
  const generateWalletLinePath = useCallback(() => {
    if (walletPositions.length < 2) return '';
    
    const sortedWallets = [...walletPositions].sort((a, b) => a.x - b.x);
    
    const line = d3.line<WalletPosition>()
      .x(d => xScale(d.x))
      .y(d => yScale(d.y))
      .curve(d3.curveCatmullRom.alpha(0.5));
    
    return line(sortedWallets) || '';
  }, [walletPositions, xScale, yScale]);

    // Apply preset curve shapes
  const applyPresetCurve = useCallback((type: 'linear' | 'exponential' | 'random') => {
    const newPositions = walletPositions.map((pos, index) => {
      const normalizedIndex = index / Math.max(wallets.length - 1, 1);
      let newY;
      let newX;
      
      switch (type) {
        case 'linear':
          newY = normalizedIndex * 100;
          newX = normalizedIndex * 100; // Full range 0% to 100%
          break;
        case 'exponential':
          newY = Math.pow(normalizedIndex, 2) * 100;
          newX = normalizedIndex * 100; // Full range 0% to 100%
          break;
        case 'random':
          newY = Math.random() * 100;
          newX = Math.random() * 100; // Random X
          break;
        default:
          newY = pos.y;
          newX = pos.x;
      }

      // Apply flip if enabled
      if (isFlipped) {
        newY = 100 - newY;
      }
      
      return {
        ...pos,
        x: newX,
        y: newY,
        calculatedDelay: (newY / 100) * userMaxDelay
      };
    });
    
    setWalletPositions(newPositions);
    updateDelays(newPositions);
    setCurveType(type);
  }, [walletPositions, wallets.length, userMaxDelay, updateDelays, isFlipped]);

  // Reset to original positions
  const resetCurve = useCallback(() => {
    applyPresetCurve('exponential');
  }, [applyPresetCurve]);

  // Handle flip toggle
  const handleFlip = useCallback(() => {
    setIsFlipped(!isFlipped);
  }, [isFlipped]);

  // Render the D3 visualization with drag functionality
  useEffect(() => {
    if (!svgRef.current) return;
    
    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();
    
    const g = svg.append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);
    
    // Add wallet-specific vertical grid lines (one per wallet)
    const walletXPositions = walletPositions.map(w => w.x);
    g.selectAll('.grid-line-x')
      .data(walletXPositions)
      .enter()
      .append('line')
      .attr('class', 'grid-line-x')
      .attr('x1', d => xScale(d))
      .attr('x2', d => xScale(d))
      .attr('y1', 0)
      .attr('y2', height)
      .attr('stroke', '#02b36d40') // Make wallet gridlines more visible
      .attr('stroke-width', 2);
    
    g.selectAll('.grid-line-y')
      .data(d3.range(0, 101, 20))
      .enter()
      .append('line')
      .attr('class', 'grid-line-y')
      .attr('x1', 0)
      .attr('x2', width)
      .attr('y1', d => yScale(d))
      .attr('y2', d => yScale(d))
      .attr('stroke', '#02b36d20')
      .attr('stroke-width', 1);
    
    // Add axes with wallet-specific X-axis labels
    const xAxis = d3.axisBottom(xScale)
      .tickValues(walletXPositions)
      .tickFormat((d, i) => `W${i + 1}`);
    
    g.append('g')
      .attr('transform', `translate(0,${height})`)
      .call(xAxis)
      .selectAll('text')
      .style('fill', '#7ddfbd')
      .style('font-family', 'monospace')
      .style('font-size', '12px');
    
    g.append('g')
      .call(d3.axisLeft(yScale).tickFormat(d => `${((d / 100) * userMaxDelay).toFixed(1)}s`))
      .selectAll('text')
      .style('fill', '#7ddfbd')
      .style('font-family', 'monospace')
      .style('font-size', '12px');
    
    // Add axis labels
    g.append('text')
      .attr('transform', `translate(${width / 2}, ${height + 35})`)
      .style('text-anchor', 'middle')
      .style('fill', '#02b36d')
      .style('font-family', 'monospace')
      .style('font-size', '14px')
      .text('Wallet Execution Order →');
    
    g.append('text')
      .attr('transform', `translate(-35, ${height / 2}) rotate(-90)`)
      .style('text-anchor', 'middle')
      .style('fill', '#02b36d')
      .style('font-family', 'monospace')
      .style('font-size', '14px')
      .text('↑ Delay (seconds)');
    
    // Draw connecting line between wallet points
    if (walletPositions.length > 1) {
      g.append('path')
        .datum(walletPositions)
        .attr('fill', 'none')
        .attr('stroke', '#02b36d')
        .attr('stroke-width', 2)
        .attr('opacity', 0.6)
        .attr('d', generateWalletLinePath());
    }
    
    // Wallet drag behavior - simpler approach
    const walletDrag = d3.drag<SVGCircleElement, WalletPosition>()
      .on('start', function() {
        d3.select(this).style('cursor', 'grabbing');
      })
      .on('drag', function(event, d) {
        // Get mouse position relative to SVG
        const [mouseX, mouseY] = d3.pointer(event, g.node());
        
        // LOCK X POSITION - wallet stays on its own gridline
        const lockedX = xScale(d.x);
        
        // Only allow Y movement - constrain to graph bounds
        const constrainedY = Math.max(0, Math.min(height, mouseY));
        
        // Update position visually immediately - don't wait for React state
        d3.select(this)
          .attr('cx', lockedX)
          .attr('cy', constrainedY);
        
        // Update labels immediately
        const walletIndex = walletPositions.findIndex(pos => pos.walletIndex === d.walletIndex);
        g.selectAll('.wallet-label')
          .filter((_, i) => i === walletIndex)
          .attr('x', lockedX)
          .attr('y', constrainedY - 15);
          
        const yPercent = ((height - constrainedY) / height) * 100;
        const calculatedDelay = (yPercent / 100) * userMaxDelay;
        
        g.selectAll('.delay-label')
          .filter((_, i) => i === walletIndex)
          .attr('x', lockedX)
          .attr('y', constrainedY + 20)
          .text(`${calculatedDelay.toFixed(2)}s`);
      })
      .on('end', function(event, d) {
        d3.select(this).style('cursor', 'grab');
        
        // Only update React state on drag end to avoid conflicts
        const [mouseX, mouseY] = d3.pointer(event, g.node());
        const constrainedY = Math.max(0, Math.min(height, mouseY));
        const yPercent = ((height - constrainedY) / height) * 100;
        
        console.log('Drag ended - Final Y percent:', yPercent);
        
        // Update wallet position data
        const newPositions = [...walletPositions];
        const walletIndex = newPositions.findIndex(pos => pos.walletIndex === d.walletIndex);
        if (walletIndex !== -1) {
          newPositions[walletIndex] = {
            ...newPositions[walletIndex],
            y: yPercent,
            calculatedDelay: (yPercent / 100) * userMaxDelay
          };
          
          setWalletPositions(newPositions);
          updateDelays(newPositions);
          setCurveType('custom');
          
          // Update connecting line
          g.select('path')
            .datum(newPositions)
            .attr('d', generateWalletLinePath());
        }
      });
    
    // Draw wallet positions with drag
    const walletCircles = g.selectAll('.wallet-point')
      .data(walletPositions)
      .enter()
      .append('circle')
      .attr('class', 'wallet-point')
      .attr('cx', d => xScale(d.x))
      .attr('cy', d => yScale(d.y))
      .attr('r', 8)
      .attr('fill', '#ff6b35')
      .attr('stroke', '#e4fbf2')
      .attr('stroke-width', 2)
      .style('cursor', 'grab')
      .style('opacity', 0.9);
    
    // Apply drag behavior
    walletCircles.call(walletDrag);
    
    // Add wallet labels
    g.selectAll('.wallet-label')
      .data(walletPositions)
      .enter()
      .append('text')
      .attr('class', 'wallet-label')
      .attr('x', d => xScale(d.x))
      .attr('y', d => yScale(d.y) - 15)
      .style('text-anchor', 'middle')
      .style('fill', '#e4fbf2')
      .style('font-family', 'monospace')
      .style('font-size', '10px')
      .style('font-weight', 'bold')
      .style('pointer-events', 'none')
      .text((d, i) => `W${i + 1}`);
    
    // Add delay value labels
    g.selectAll('.delay-label')
      .data(walletPositions)
      .enter()
      .append('text')
      .attr('class', 'delay-label')
      .attr('x', d => xScale(d.x))
      .attr('y', d => yScale(d.y) + 20)
      .style('text-anchor', 'middle')
      .style('fill', '#7ddfbd')
      .style('font-family', 'monospace')
      .style('font-size', '9px')
      .style('pointer-events', 'none')
      .text(d => `${d.calculatedDelay.toFixed(2)}s`);
    
  }, [walletPositions, xScale, yScale, width, height, margin, userMaxDelay, generateWalletLinePath, updateDelays]);

  return (
    <div className={`delay-curve-component ${className}`}>
      {/* Hide number input spinners */}
      <style>{`
        .delay-curve-component input[type="number"]::-webkit-outer-spin-button,
        .delay-curve-component input[type="number"]::-webkit-inner-spin-button {
          -webkit-appearance: none;
          margin: 0;
        }
        .delay-curve-component input[type="number"] {
          -moz-appearance: textfield;
        }
      `}</style>
      
      {/* Header with controls */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Clock size={16} className="text-[#02b36d]" />
          <h3 className="text-sm font-mono text-[#02b36d] tracking-wider">DELAY CURVE DESIGNER</h3>
        </div>
        
        <div className="flex items-center justify-between">
          <div className="flex gap-2">
            <button
              onClick={() => applyPresetCurve('linear')}
              className="px-2 py-1 text-xs bg-[#02b36d20] border border-[#02b36d40] rounded text-[#02b36d] hover:bg-[#02b36d30] transition-colors font-mono"
            >
              <Minus size={12} className="inline mr-1" />
              LINEAR
            </button>
            <button
              onClick={() => applyPresetCurve('exponential')}
              className="px-2 py-1 text-xs bg-[#02b36d20] border border-[#02b36d40] rounded text-[#02b36d] hover:bg-[#02b36d30] transition-colors font-mono"
            >
              <TrendingUp size={12} className="inline mr-1" />
              EXPONENTIAL
            </button>
            <button
              onClick={() => applyPresetCurve('random')}
              className="px-2 py-1 text-xs bg-[#02b36d20] border border-[#02b36d40] rounded text-[#02b36d] hover:bg-[#02b36d30] transition-colors font-mono"
            >
              <Shuffle size={12} className="inline mr-1" />
              RANDOM
            </button>
            <div className="border-l border-[#02b36d40] pl-2 ml-2">
              <button
                onClick={handleFlip}
                className={`px-2 py-1 text-xs rounded font-mono transition-colors mr-2 ${
                  isFlipped 
                    ? 'bg-[#02b36d] text-[#050a0e]' 
                    : 'bg-[#02b36d20] border border-[#02b36d40] text-[#02b36d] hover:bg-[#02b36d30]'
                }`}
              >
                <FlipVertical size={12} className="inline mr-1" />
                FLIP
              </button>
              <button
                onClick={resetCurve}
                className="px-2 py-1 text-xs bg-[#02b36d20] border border-[#02b36d40] rounded text-[#02b36d] hover:bg-[#02b36d30] transition-colors font-mono"
              >
                <RotateCcw size={12} className="inline mr-1" />
                RESET
              </button>
            </div>
          </div>
          
          {/* Spacer */}
          <div className="border-l border-[#02b36d40] h-6 mx-4"></div>
          
          {/* Y-axis max delay control */}
          <div className="flex items-center gap-2">
            <label className="text-xs text-[#7ddfbd] font-mono">MAX DELAY:</label>
            <input
              type="number"
              value={maxDelayInput}
              onChange={(e) => {
                const value = e.target.value;
                setMaxDelayInput(value);
                
                // Update actual delay value, defaulting to 10 if empty or invalid
                const numericValue = value === '' ? 10 : Math.max(1, Math.min(60, parseInt(value) || 10));
                setUserMaxDelay(numericValue);
              }}
              onBlur={() => {
                // Ensure input shows the actual value on blur
                if (maxDelayInput === '' || isNaN(parseInt(maxDelayInput))) {
                  setMaxDelayInput('10');
                  setUserMaxDelay(10);
                } else {
                  setMaxDelayInput(userMaxDelay.toString());
                }
              }}
              className="w-16 px-2 py-1 text-xs bg-[#050a0e] border border-[#02b36d30] rounded text-[#e4fbf2] focus:outline-none focus:border-[#02b36d] font-mono text-center"
              min="1"
              max="60"
              placeholder="10"
            />
            <span className="text-xs text-[#7ddfbd] font-mono">SEC</span>
          </div>
        </div>
      </div>

      {/* Graph container */}
      <div 
        ref={setContainerRef}
        className="bg-[#050a0e] border border-[#02b36d30] rounded-lg p-4 relative overflow-hidden w-full">
        <div className="absolute inset-0 z-0 opacity-5"
             style={{
               backgroundImage: 'linear-gradient(rgba(2, 179, 109, 0.2) 1px, transparent 1px), linear-gradient(90deg, rgba(2, 179, 109, 0.2) 1px, transparent 1px)',
               backgroundSize: '20px 20px'
             }}>
        </div>
        
        <svg
          ref={svgRef}
          width={containerWidth}
          height={400}
          className="relative z-10"
          style={{ userSelect: 'none' }}
        />
      </div>

      {/* Legend */}
      <div className="mt-3 flex items-center justify-between text-xs font-mono">
        <div className="flex gap-4">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-[#ff6b35] border border-[#e4fbf2]"></div>
            <span className="text-[#7ddfbd]">Wallets (vertical sliders)</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-1 h-4 bg-[#02b36d] rounded"></div>
            <span className="text-[#7ddfbd]">Wallet Gridlines</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-1 bg-[#02b36d] rounded"></div>
            <span className="text-[#7ddfbd]">Connection Line</span>
          </div>
        </div>
        <div className="text-[#7ddfbd]">
          {isFlipped ? 'FLIPPED: Fast → Slow' : 'NORMAL: Slow → Fast'} | 
          Max: {userMaxDelay}s | 
          Total Time: ~{walletPositions.length > 0 ? Math.max(...walletPositions.map(p => p.calculatedDelay)).toFixed(2) : '0.00'}s
        </div>
      </div>
    </div>
  );
}; 
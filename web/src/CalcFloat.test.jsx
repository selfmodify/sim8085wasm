import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CalcFloat } from './CalcFloat.jsx';

describe('CalcFloat Component', () => {
  it('renders all four number bases', () => {
    render(<CalcFloat onClose={vi.fn()} />);
    
    expect(screen.getByText('BIN')).toBeInTheDocument();
    expect(screen.getByText('OCT')).toBeInTheDocument();
    expect(screen.getByText('DEC')).toBeInTheDocument();
    expect(screen.getByText('HEX')).toBeInTheDocument();
  });

  it('updates all other bases when a HEX value is entered', () => {
    render(<CalcFloat onClose={vi.fn()} />);

    const hexInput = screen.getByPlaceholderText('FFFF');
    const decInput = screen.getByPlaceholderText('65535');
    const binInput = screen.getByPlaceholderText('1111111111111111');

    fireEvent.change(hexInput, { target: { value: 'FF' } });

    expect(decInput.value).toBe('255');
    expect(binInput.value).toBe('11111111');
  });
});
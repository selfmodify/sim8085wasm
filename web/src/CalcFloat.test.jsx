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
    
    // Get the inputs (ordered: BIN, OCT, DEC, HEX based on CALC_BASES array)
    const inputs = screen.getAllByRole('textbox');
    const hexInput = inputs[3];
    const decInput = inputs[2];
    const binInput = inputs[0];

    // Simulate a user typing "FF" into the hex field
    fireEvent.change(hexInput, { target: { value: 'FF' } });

    // Check that the decimal and binary fields auto-calculated correctly
    expect(decInput.value).toBe('255');
    expect(binInput.value).toBe('11111111');
  });
});
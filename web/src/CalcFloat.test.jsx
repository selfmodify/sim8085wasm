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

  it('updates all other bases when a DEC value is entered', () => {
    render(<CalcFloat onClose={vi.fn()} />);

    const hexInput = screen.getByPlaceholderText('FFFF');
    const decInput = screen.getByPlaceholderText('65535');
    const octInput = screen.getByPlaceholderText('177777');

    fireEvent.change(decInput, { target: { value: '128' } });

    expect(hexInput.value).toBe('80');
    expect(octInput.value).toBe('200');
  });

  it('updates all other bases when a BIN value is entered', () => {
    render(<CalcFloat onClose={vi.fn()} />);

    const binInput = screen.getByPlaceholderText('1111111111111111');
    const decInput = screen.getByPlaceholderText('65535');
    const hexInput = screen.getByPlaceholderText('FFFF');

    fireEvent.change(binInput, { target: { value: '101010' } });

    expect(decInput.value).toBe('42');
    expect(hexInput.value).toBe('2A');
  });
});
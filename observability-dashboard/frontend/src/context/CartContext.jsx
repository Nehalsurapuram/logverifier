import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

const STORAGE_KEY = 'observability-demo.cart';
const CartContext = createContext(null);

/**
 * The cart lives entirely in the browser.
 *
 * That is a real decision, not a shortcut: an order is only created when the
 * customer checks out, which is the moment stock is reserved. Persisting carts
 * server-side would mean reserving stock for people who never buy, or
 * reconciling a cart against a catalogue that moved underneath it.
 *
 * Prices here are display copies. The backend recomputes every total from its
 * own data at checkout, so a tampered cart cannot change what is charged.
 */
export function CartProvider({ children }) {
  const [lines, setLines] = useState(read);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(lines));
    } catch {
      /* storage unavailable; the cart just will not survive a reload */
    }
  }, [lines]);

  const add = useCallback((product, quantity = 1) => {
    setLines((current) => {
      const existing = current.find((line) => line.productId === product.id);

      if (existing) {
        // Never offer more than exists — the backend would reject it with a
        // 409 anyway, and failing at the button is friendlier than at checkout.
        const capped = Math.min(existing.quantity + quantity, product.stock);
        return current.map((line) =>
          line.productId === product.id ? { ...line, quantity: capped } : line,
        );
      }

      return [
        ...current,
        {
          productId: product.id,
          sku: product.sku,
          name: product.name,
          unitPriceCents: product.price.amountCents,
          formattedPrice: product.price.formatted,
          stock: product.stock,
          quantity: Math.min(quantity, product.stock),
        },
      ];
    });
  }, []);

  const setQuantity = useCallback((productId, quantity) => {
    setLines((current) =>
      current.flatMap((line) => {
        if (line.productId !== productId) return [line];
        const next = Math.max(0, Math.min(quantity, line.stock));
        return next === 0 ? [] : [{ ...line, quantity: next }];
      }),
    );
  }, []);

  const remove = useCallback((productId) => {
    setLines((current) => current.filter((line) => line.productId !== productId));
  }, []);

  const clear = useCallback(() => setLines([]), []);

  const value = useMemo(() => {
    const itemCount = lines.reduce((sum, line) => sum + line.quantity, 0);
    const subtotalCents = lines.reduce((sum, line) => sum + line.unitPriceCents * line.quantity, 0);

    return {
      lines,
      itemCount,
      subtotalCents,
      // Display only. The authoritative figure comes back from the order.
      subtotalFormatted: `${(subtotalCents / 100).toFixed(2)} USD`,
      add,
      setQuantity,
      remove,
      clear,
      toOrderItems: () => lines.map((line) => ({ productId: line.productId, quantity: line.quantity })),
    };
  }, [lines, add, setQuantity, remove, clear]);

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart() {
  const context = useContext(CartContext);
  if (!context) throw new Error('useCart must be used inside a CartProvider');
  return context;
}

function read() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

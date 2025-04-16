import { products } from './products';

export function initConnection() {
  return Promise.resolve(true);
}

export function endConnection() {
  return Promise.resolve();
}

export function finishTransaction() {
  return Promise.resolve();
}

export function purchaseUpdatedListener() {
  return Promise.resolve();
}

export async function getAvailablePurchases() {
  return Promise.resolve([]);
}

export function requestPurchase() {
  return Promise.resolve();
}

export function getSubscriptions() {
  return Promise.resolve(products);
}

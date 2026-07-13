import { useState } from "react";
import {
  reserveCloudReceiptNumber,
  reserveCloudReceiptNumbers
} from "../../cloudData";
import { nextReceiptNumber } from "../../storage";
import type { Client, Payment } from "../../types";
import { isReceiptNumberConflict } from "./paymentPersistenceErrors";

type Options = {
  payments: Payment[];
  onClientsChange: (next: Client[]) => void;
  onPaymentsChange: (next: Payment[]) => void;
  onPersistClientPayment?: (nextClients: Client[], nextPayments: Payment[]) => Promise<boolean>;
  dataOwnerUserId?: string | null;
};


export default function usePaymentPersistence({
  payments,
  onClientsChange,
  onPaymentsChange,
  onPersistClientPayment,
  dataOwnerUserId
}: Options) {
  const [paymentInfo, setPaymentInfo] = useState("");

  async function reserveReceiptNumber(): Promise<string> {
    if (dataOwnerUserId) {
      return reserveCloudReceiptNumber(dataOwnerUserId);
    }
    return nextReceiptNumber();
  }

  async function retryWithFreshReceiptNumbers(
    nextClients: Client[],
    nextPayments: Payment[]
  ): Promise<boolean> {
    if (!onPersistClientPayment || !dataOwnerUserId) return false;
    const existingPaymentIds = new Set(payments.map((payment) => payment.id));
    const retryPayments = nextPayments.map((payment) => ({ ...payment }));
    const newPaymentIndexes = retryPayments
      .map((payment, index) => existingPaymentIds.has(payment.id) ? -1 : index)
      .filter((index) => index >= 0);
    if (newPaymentIndexes.length === 0) return false;

    const freshReceipts = newPaymentIndexes.length === 1
      ? [await reserveReceiptNumber()]
      : await reserveCloudReceiptNumbers(dataOwnerUserId, newPaymentIndexes.length);
    newPaymentIndexes.forEach((paymentIndex, receiptIndex) => {
      nextPayments[paymentIndex].receiptNumber = freshReceipts[receiptIndex];
      retryPayments[paymentIndex] = {
        ...retryPayments[paymentIndex],
        receiptNumber: freshReceipts[receiptIndex]
      };
    });
    return onPersistClientPayment(nextClients, retryPayments);
  }

  async function persistClientPaymentState(
    nextClients: Client[],
    nextPayments: Payment[]
  ): Promise<boolean> {
    if (onPersistClientPayment) {
      try {
        const saved = await onPersistClientPayment(nextClients, nextPayments);
        if (saved) return true;
        setPaymentInfo("");
        return false;
      } catch (error) {
        console.error("Persistencia cloud no disponible. No se aplicaron cambios locales.", error);
        if (isReceiptNumberConflict(error)) {
          const savedWithFreshReceipt = await retryWithFreshReceiptNumbers(nextClients, nextPayments);
          if (savedWithFreshReceipt) {
            setPaymentInfo("Pago guardado con un nuevo numero de recibo.");
            return true;
          }
        }
        setPaymentInfo("");
        throw error;
      }
    }
    onClientsChange(nextClients);
    onPaymentsChange(nextPayments);
    return true;
  }

  return {
    paymentInfo,
    setPaymentInfo,
    persistClientPaymentState,
    reserveReceiptNumber
  };
}

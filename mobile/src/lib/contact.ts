import { Linking } from 'react-native';

// Ligar ou abrir o WhatsApp do contato (número brasileiro sem DDI ganha o 55).
export const digits = (phone: string) => phone.replace(/\D/g, '');
export const call = (phone: string) => Linking.openURL(`tel:${digits(phone)}`);
export const whatsapp = (phone: string) => {
  const number = digits(phone);
  return Linking.openURL(`https://wa.me/${number.length <= 11 ? `55${number}` : number}`);
};

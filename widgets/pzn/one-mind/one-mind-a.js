/**
 * PZN treatment — variant A: loads the 1Mind launcher script.
 */
export default function decorate() {
  const s = document.createElement('script');
  s.defer = true;
  s.src = 'https://launcher.1mind.com/deployment-6dfht8qjmt';
  document.head.appendChild(s);
}

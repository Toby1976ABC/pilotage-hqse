# Pilotage HQSE – Cabane & Cie

Application web installable (PWA) pour suivre les alertes HQSE et saisir les contrôles depuis un téléphone.
Les données sont dans Supabase (projet `cabane-hqse`) ; l'accès est réservé aux adresses de la table `acces`.

## Rôles
- `direction` : tout voir, prendre en charge, ignorer une alerte, gérer les accès.
- `qse` et `operationnel` : tout voir, saisir les contrôles réalisés, prendre en charge une alerte.

## Ajouter une personne
Dans Supabase (SQL) : `insert into public.acces(email, nom, role) values ('prenom.nom@cabaneetcie.fr', 'Prénom Nom', 'qse');`

## Publication
Fichiers statiques : GitHub Pages (branche `main`, dossier racine).
Dans Supabase › Authentication › URL Configuration : Site URL = l'adresse GitHub Pages, et l'ajouter aux Redirect URLs.

## Installer sur le téléphone
iPhone : ouvrir l'adresse dans Safari › Partager › « Sur l'écran d'accueil ».
Android : Chrome › menu › « Installer l'application ».

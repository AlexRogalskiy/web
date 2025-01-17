import {
    Component,
    OnInit,
    ViewChild,
} from '@angular/core';
import { Router } from '@angular/router';

import { ToasterService } from 'angular2-toaster';

import { ApiService } from 'jslib-common/abstractions/api.service';
import { I18nService } from 'jslib-common/abstractions/i18n.service';
import { LogService } from 'jslib-common/abstractions/log.service';
import { MessagingService } from 'jslib-common/abstractions/messaging.service';
import { PlatformUtilsService } from 'jslib-common/abstractions/platformUtils.service';
import { SyncService } from 'jslib-common/abstractions/sync.service';
import { TokenService } from 'jslib-common/abstractions/token.service';
import { UserService } from 'jslib-common/abstractions/user.service';

import { PaymentComponent } from './payment.component';
import { TaxInfoComponent } from './tax-info.component';

@Component({
    selector: 'app-premium',
    templateUrl: 'premium.component.html',
})
export class PremiumComponent implements OnInit {
    @ViewChild(PaymentComponent) paymentComponent: PaymentComponent;
    @ViewChild(TaxInfoComponent) taxInfoComponent: TaxInfoComponent;

    canAccessPremium = false;
    selfHosted = false;
    premiumPrice = 10;
    storageGbPrice = 4;
    additionalStorage = 0;

    formPromise: Promise<any>;

    constructor(private apiService: ApiService, private i18nService: I18nService,
        private toasterService: ToasterService, platformUtilsService: PlatformUtilsService,
        private tokenService: TokenService, private router: Router,
        private messagingService: MessagingService, private syncService: SyncService,
        private userService: UserService, private logService: LogService) {
        this.selfHosted = platformUtilsService.isSelfHost();
    }

    async ngOnInit() {
        this.canAccessPremium = await this.userService.canAccessPremium();
        const premium = await this.tokenService.getPremium();
        if (premium) {
            this.router.navigate(['/settings/subscription']);
            return;
        }
    }

    async submit() {
        let files: FileList = null;
        if (this.selfHosted) {
            const fileEl = document.getElementById('file') as HTMLInputElement;
            files = fileEl.files;
            if (files == null || files.length === 0) {
                this.toasterService.popAsync('error', this.i18nService.t('errorOccurred'),
                    this.i18nService.t('selectFile'));
                return;
            }
        }

        try {
            if (this.selfHosted) {
                if (!this.tokenService.getEmailVerified()) {
                    this.toasterService.popAsync('error', this.i18nService.t('errorOccurred'),
                        this.i18nService.t('verifyEmailFirst'));
                    return;
                }

                const fd = new FormData();
                fd.append('license', files[0]);
                this.formPromise = this.apiService.postAccountLicense(fd).then(() => {
                    return this.finalizePremium();
                });
            } else {
                this.formPromise = this.paymentComponent.createPaymentToken().then(result => {
                    const fd = new FormData();
                    fd.append('paymentMethodType', result[1].toString());
                    if (result[0] != null) {
                        fd.append('paymentToken', result[0]);
                    }
                    fd.append('additionalStorageGb', (this.additionalStorage || 0).toString());
                    fd.append('country', this.taxInfoComponent.taxInfo.country);
                    fd.append('postalCode', this.taxInfoComponent.taxInfo.postalCode);
                    return this.apiService.postPremium(fd);
                }).then(paymentResponse => {
                    if (!paymentResponse.success && paymentResponse.paymentIntentClientSecret != null) {
                        return this.paymentComponent.handleStripeCardPayment(paymentResponse.paymentIntentClientSecret,
                            () => this.finalizePremium());
                    } else {
                        return this.finalizePremium();
                    }
                });
            }
            await this.formPromise;
        } catch (e) {
            this.logService.error(e);
        }
    }

    async finalizePremium() {
        await this.apiService.refreshIdentityToken();
        await this.syncService.fullSync(true);
        this.toasterService.popAsync('success', null, this.i18nService.t('premiumUpdated'));
        this.messagingService.send('purchasedPremium');
        this.router.navigate(['/settings/subscription']);
    }

    get additionalStorageTotal(): number {
        return this.storageGbPrice * Math.abs(this.additionalStorage || 0);
    }

    get subtotal(): number {
        return this.premiumPrice + this.additionalStorageTotal;
    }

    get taxCharges(): number {
        return this.taxInfoComponent != null && this.taxInfoComponent.taxRate != null ?
            (this.taxInfoComponent.taxRate / 100) * this.subtotal :
            0;
    }

    get total(): number {
        return (this.subtotal + this.taxCharges) || 0;
    }
}
